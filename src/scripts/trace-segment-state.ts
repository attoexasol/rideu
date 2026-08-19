/**
 * Trace ride-video segment state for active/recent sessions.
 */
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import postgres from 'postgres';
import { videoConfig } from '../config/video';
import { inspectPrivateSegment } from '../services/ride-video-storage.service';

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const sql = postgres(DATABASE_URL);
  try {
    const sessions = await sql`
      SELECT id, booking_id, driver_id, status, consent_status, manifest_version,
             started_at, last_upload_activity_at, created_at, updated_at
      FROM video_sessions
      WHERE status IN ('active', 'paused', 'finalizing')
      ORDER BY updated_at DESC
      LIMIT 5
    `;

    console.log('=== ACTIVE/RECENT SESSIONS ===');
    console.log(JSON.stringify(sessions, null, 2));

    for (const session of sessions) {
      const segments = await sql`
        SELECT id, segment_index, client_segment_id, upload_status, storage_key,
               duration_ms, file_size, mime_type, checksum,
               recorded_at, uploaded_at, created_at, updated_at,
               retry_count, failure_reason, retention_deleted_at
        FROM video_segments
        WHERE session_id = ${session.id}::uuid
        ORDER BY segment_index ASC
      `;

      console.log(`\n=== SEGMENTS session=${session.id} booking=${session.booking_id} ===`);
      console.log(`total=${segments.length}`);

      let uploadedCount = 0;
      let verifiedCount = 0;
      let playableCount = 0;
      let storageExistingCount = 0;

      for (const seg of segments) {
        let storageExists = false;
        let storageSize = 0;
        if (seg.storage_key) {
          const inspected = await inspectPrivateSegment(seg.storage_key);
          storageExists = inspected != null;
          storageSize = inspected?.fileSizeBytes ?? 0;
          if (storageExists) storageExistingCount += 1;
        }
        if (['uploaded', 'verified'].includes(seg.upload_status)) uploadedCount += 1;
        if (seg.upload_status === 'verified') verifiedCount += 1;
        if (
          ['uploaded', 'verified'].includes(seg.upload_status) &&
          seg.storage_key &&
          !seg.retention_deleted_at &&
          storageExists
        ) {
          playableCount += 1;
        }

        console.log(
          JSON.stringify({
            segmentId: seg.id,
            segmentIndex: seg.segment_index,
            uploadStatus: seg.upload_status,
            durationMs: seg.duration_ms,
            fileSize: seg.file_size,
            storageKey: seg.storage_key,
            storageExists,
            storageSizeBytes: storageSize,
            playable:
              ['uploaded', 'verified'].includes(seg.upload_status) &&
              Boolean(seg.storage_key) &&
              storageExists,
            recordedAt: seg.recorded_at,
            uploadedAt: seg.uploaded_at,
            failureReason: seg.failure_reason,
          })
        );
      }

      console.log(
        JSON.stringify({
          sessionId: session.id,
          segmentRows: segments.length,
          uploadedCount,
          verifiedCount,
          storageExistingCount,
          playableCount,
        })
      );
    }

    // Recent segments regardless of session status
    const recentSegments = await sql`
      SELECT vs.id, vs.session_id, vs.booking_id, vs.segment_index, vs.upload_status,
             vs.storage_key, vs.created_at, vses.status AS session_status
      FROM video_segments vs
      JOIN video_sessions vses ON vses.id = vs.session_id
      ORDER BY vs.created_at DESC
      LIMIT 20
    `;
    console.log('\n=== RECENT SEGMENTS (last 20) ===');
    console.log(JSON.stringify(recentSegments, null, 2));

    // Storage root listing
    const storageRoot = videoConfig.storageRoot;
    console.log(`\n=== STORAGE ROOT: ${storageRoot} ===`);
    try {
      const entries = await fs.readdir(storageRoot, { withFileTypes: true });
      console.log(
        'top-level:',
        entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      );
      const container = path.join(storageRoot, videoConfig.storageContainer);
      const containerExists = await fs.stat(container).then(() => true).catch(() => false);
      if (containerExists) {
        const bookings = await fs.readdir(container);
        console.log(`container ${videoConfig.storageContainer} bookings:`, bookings.slice(0, 10));
      }
    } catch (e) {
      console.log('storage root error:', (e as Error).message);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
