#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

async function main() {
  try {
    const serviceAccountPath = path.resolve(__dirname, '../../arona-mk-2-firebase-adminsdk-fbsvc-77389f5402.json');
    if (!fs.existsSync(serviceAccountPath)) {
      console.error(`[init] Service account JSON not found at: ${serviceAccountPath}`);
      process.exit(1);
      return;
    }
    const serviceAccount = require(serviceAccountPath);

    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('[init] Firebase Admin initialized.');
    } else {
      console.log('[init] Firebase Admin already initialized, reusing existing app.');
    }

    const db = admin.firestore();
    const { FieldPath, FieldValue } = admin.firestore;

    const DEFAULT_EMOTION_SET = ['행복','슬픔','분노','사랑','중립'];

    function sanitizeLabels(input) {
      if (!Array.isArray(input)) return [];
      const out = [];
      for (const v of input) {
        const s = String(v ?? '').trim();
        if (!s) continue;
        if (!out.includes(s)) out.push(s);
        if (out.length >= 32) break;
      }
      return out;
    }

    function needsCustomEmotionsFix(data) {
      const src = data && Array.isArray(data.customEmotions) ? data.customEmotions : null;
      if (!src) return true;
      const sanitized = sanitizeLabels(src);
      return sanitized.length === 0;
    }

    const PAGE_SIZE = 500;
    const BATCH_LIMIT = 500;

    let scanned = 0;
    let updated = 0;
    let batchesCommitted = 0;
    let page = 0;
    let lastId = undefined;

    while (true) {
      let q = db.collection('characters')
        .orderBy(FieldPath.documentId())
        .limit(PAGE_SIZE);
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

        let patch = null;
        if (needsCustomEmotionsFix(data)) {
          patch = { customEmotions: DEFAULT_EMOTION_SET.slice(0), updatedAt: FieldValue.serverTimestamp() };
        } else {
          // sanitize in-place if duplicates or empties exist
          const sanitized = sanitizeLabels(data.customEmotions);
          if (JSON.stringify(sanitized) !== JSON.stringify(data.customEmotions)) {
            patch = { customEmotions: sanitized.length ? sanitized : DEFAULT_EMOTION_SET.slice(0), updatedAt: FieldValue.serverTimestamp() };
          }
        }

        if (patch) {
          batch.update(doc.ref, patch);
          updated += 1;
          ops += 1;

          if (ops >= BATCH_LIMIT) {
            await batch.commit();
            batchesCommitted += 1;
            batch = db.batch();
            ops = 0;
          }
        }
      }

      if (ops > 0) {
        await batch.commit();
        batchesCommitted += 1;
      }

      console.log(`[page ${page}] scanned=${scanned} updated=${updated} batches=${batchesCommitted} lastId=${lastId}`);
    }

    console.log(`[done] Updated ${updated} of ${scanned} documents. batches=${batchesCommitted} lastId=${lastId || 'n/a'}`);
    process.exit(0);
  } catch (err) {
    console.error('[error] Migration failed:', err && err.stack || err);
    process.exit(1);
  }
}

main();