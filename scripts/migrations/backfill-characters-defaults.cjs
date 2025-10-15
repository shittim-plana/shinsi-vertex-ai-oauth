#!/usr/bin/env node
'use strict';

/**
 * 백필 스크립트: characters 컬렉션에 누락된 기본 필드 채우기
 *
 * 실행 방법:
 * - 실제 실행: npm run migrate:backfill-characters-defaults
 * - 드라이런: npm run migrate:backfill-characters-defaults:dry
 * - 배치/페이지 크기 조정: npm run migrate:backfill-characters-defaults -- --batch-size 300 --page-size 600
 *
 * 백필 필드:
 * - isPublic: 누락 시 false
 * - isDeleted: 누락 시 false
 * - createdAt: 우선순위 - doc.createTime, data.updatedAt (Timestamp), 현재 시간
 * - updatedAt: 우선순위 - doc.updateTime, createdAt, 현재 시간
 *
 * 주의사항:
 * - 기존 값은 절대 덮어쓰지 않음
 * - createdAt은 과거 문서에 대해 createTime 기반으로 채움
 * - Timestamp 판별은 toDate 함수 존재 여부로 런타임 판별
 */

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

// CLI 인자 파싱
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    batchSize: 400,
    pageSize: 500,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--batch-size' && i + 1 < args.length) {
      options.batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--page-size' && i + 1 < args.length) {
      options.pageSize = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return options;
}

// Timestamp 판별 유틸 (런타임 판별)
function isTimestamp(value) {
  return value && typeof value.toDate === 'function';
}

// Firebase Admin 초기화 (우선순위대로)
async function initializeFirebase() {
  // 1. GOOGLE_APPLICATION_CREDENTIALS 환경변수
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('[init] Using GOOGLE_APPLICATION_CREDENTIALS');
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
    return;
  }

  // 2. FIREBASE_SERVICE_ACCOUNT 환경변수 (JSON 문자열)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log('[init] Using FIREBASE_SERVICE_ACCOUNT env var');
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return;
  }

  // 3. 루트의 서비스 계정 파일
  const serviceAccountPath = path.resolve(__dirname, '../../arona-mk-2-firebase-adminsdk-fbsvc-77389f5402.json');
  if (fs.existsSync(serviceAccountPath)) {
    console.log('[init] Using service account file:', serviceAccountPath);
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return;
  }

  throw new Error('No Firebase credentials found. Set GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_SERVICE_ACCOUNT, or ensure service account file exists.');
}

async function main() {
  try {
    const options = parseArgs();
    console.log('[init] Options:', options);

    // Firebase 초기화
    await initializeFirebase();
    console.log('[init] Firebase Admin initialized.');

    const db = admin.firestore();
    const { FieldPath, FieldValue, Timestamp } = admin.firestore;

    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    let batchesCommitted = 0;
    let page = 0;
    let lastId = undefined;

    while (true) {
      let q = db.collection('characters')
        .orderBy(FieldPath.documentId())
        .limit(options.pageSize);
      if (lastId) {
        q = q.startAfter(lastId);
      }

      const snap = await q.get();
      if (snap.empty) break;

      page += 1;
      lastId = snap.docs[snap.docs.length - 1].id;

      let batch = db.batch();
      let ops = 0;

      for (const doc of snap.docs) {
        scanned += 1;
        const data = doc.data() || {};
        const updates = {};

        // isPublic 백필
        if (typeof data.isPublic !== 'boolean') {
          updates.isPublic = false;
        }

        // isDeleted 백필
        if (typeof data.isDeleted !== 'boolean') {
          updates.isDeleted = false;
        }

        // createdAt 백필
        if (!data.createdAt) {
          if (doc.createTime) {
            updates.createdAt = Timestamp.fromDate(doc.createTime.toDate());
          } else if (data.updatedAt && isTimestamp(data.updatedAt)) {
            updates.createdAt = data.updatedAt;
          } else {
            updates.createdAt = Timestamp.now();
          }
        }

        // updatedAt 백필
        if (!data.updatedAt) {
          if (doc.updateTime) {
            updates.updatedAt = Timestamp.fromDate(doc.updateTime.toDate());
          } else if (updates.createdAt) {
            updates.updatedAt = updates.createdAt;
          } else if (data.createdAt && isTimestamp(data.createdAt)) {
            updates.updatedAt = data.createdAt;
          } else {
            updates.updatedAt = Timestamp.now();
          }
        }

        if (Object.keys(updates).length > 0) {
          if (options.dryRun) {
            console.log(`[dry-run] ${doc.ref.path} -> ${Object.keys(updates).join(', ')}`);
          } else {
            batch.update(doc.ref, updates);
            ops += 1;

            if (ops >= options.batchSize) {
              try {
                await batch.commit();
                batchesCommitted += 1;
                batch = db.batch();
                ops = 0;
              } catch (err) {
                console.error(`[error] Batch commit failed:`, err.message);
                errors += 1;
              }
            }
          }
          updated += 1;
        } else {
          skipped += 1;
        }
      }

      if (!options.dryRun && ops > 0) {
        try {
          await batch.commit();
          batchesCommitted += 1;
        } catch (err) {
          console.error(`[error] Final batch commit failed:`, err.message);
          errors += 1;
        }
      }

      console.log(`[page ${page}] scanned=${scanned} updated=${updated} skipped=${skipped} errors=${errors} batches=${batchesCommitted} lastId=${lastId}`);
    }

    console.log(`[done] scanned=${scanned} updated=${updated} skipped=${skipped} errors=${errors} batches=${batchesCommitted} lastId=${lastId || 'n/a'}`);
    if (options.dryRun) {
      console.log('[done] Dry run completed. No changes made.');
    }
    process.exit(0);
  } catch (err) {
    console.error('[error] Migration failed:', err && err.stack || err);
    process.exit(1);
  }
}

main();