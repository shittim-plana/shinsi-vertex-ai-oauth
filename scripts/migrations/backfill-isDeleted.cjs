#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

async function main() {
  try {
    // Load service account
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
    const { FieldPath, FieldValue, Timestamp } = admin.firestore;

    const PAGE_SIZE = 500; // pagination size
    const BATCH_LIMIT = 500; // Firestore max batch operations

    let scanned = 0;
    let updated = 0;
    let batchesCommitted = 0;
    let page = 0;
    let lastId = undefined;

    function needsIsDeletedFix(val) {
      return typeof val !== 'boolean';
    }

    function needsDeletedAtFix(obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, 'deletedAt')) return 'missing';
      const v = obj.deletedAt;
      if (v === null) return false; // valid
      // Accept Firestore Timestamp instances; otherwise treat as invalid
      if (v instanceof Timestamp) return false;
      return 'invalid';
    }

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
        const patch = {};

        if (needsIsDeletedFix(data.isDeleted)) {
          patch.isDeleted = false;
        }

        const deletedAtState = needsDeletedAtFix(data);
        if (deletedAtState === 'missing' || deletedAtState === 'invalid') {
          patch.deletedAt = null;
        }

        if (Object.keys(patch).length > 0) {
          patch.updatedAt = FieldValue.serverTimestamp();
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