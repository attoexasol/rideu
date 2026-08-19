import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import postgres from 'postgres';
import { videoConfig } from '../config/video';
import { inspectPrivateSegment } from '../services/ride-video-storage.service';

const SESSION_ID = '27a93d27-9d85-4583-a34a-c0517dca203e';
const BOOKING_ID = 'fc7a736c-d4ff-4e70-b342-b4bfc32687e7';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    const sessions = await sql`
      SELECT id, booking_id, driver_id, passenger_id, status, consent_status,
             manifest_version, last_upload_activity_at, started_at, finalized_at,
             ended_at, failure_reason, created_at, updated_at
      FROM video_sessions WHERE id = ${SESSION_ID}::uuid
    `;
    console.log('=== SESSION ===');
    console.log(JSON.stringify(sessions[0], null, 2));

    const booking = await sql`
      SELECT id, status, assigned_driver_id, recording_consent_status, recording_consented_at
      FROM bookings WHERE id = ${BOOKING_ID}::uuid
    `;
    console.log('\n=== BOOKING ===');
    console.log(JSON.stringify(booking[0], null, 2));

    const segments = await sql`
      SELECT id, segment_index, client_segment_id, upload_status, storage_key,
             duration_ms, file_size, mime_type, checksum, recorded_at, uploaded_at,
             retry_count, failure_reason, retention_deleted_at, created_at, updated_at
      FROM video_segments
      WHERE session_id = ${SESSION_ID}::uuid
      ORDER BY segment_index ASC
    `;
    console.log('\n=== SEGMENTS total=' + segments.length + ' ===');
    for (const s of segments) {
      let storageExists = false;
      let storageSize = 0;
      if (s.storage_key) {
        const obj = await inspectPrivateSegment(s.storage_key);
        storageExists = obj != null;
        storageSize = obj?.fileSizeBytes ?? 0;
      }
      console.log(JSON.stringify({
        segmentId: s.id,
        segmentIndex: s.segment_index,
        uploadStatus: s.upload_status,
        durationMs: s.duration_ms,
        fileSize: s.file_size,
        mimeType: s.mime_type,
        storageKey: s.storage_key,
        storageExists,
        storageSizeBytes: storageSize,
        recordedAt: s.recorded_at,
        uploadedAt: s.uploaded_at,
        failureReason: s.failure_reason,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      }));
    }

    console.log('\n=== VIDEO CONFIG ===');
    console.log(JSON.stringify({
      maxSegmentSizeBytes: videoConfig.maxSegmentSizeBytes,
      uploadUrlTtlSeconds: videoConfig.uploadUrlTtlSeconds,
      segmentDurationSeconds: videoConfig.segmentDurationSeconds,
      storageRoot: videoConfig.storageRoot,
      storageContainer: videoConfig.storageContainer,
      apiPublicBaseUrl: videoConfig.apiPublicBaseUrl || null,
    }));

    const storageDir = path.join(
      videoConfig.storageRoot,
      videoConfig.storageContainer,
      BOOKING_ID,
      SESSION_ID
    );
    console.log('\n=== STORAGE DIR: ' + storageDir + ' ===');
    try {
      const files = await fs.readdir(storageDir);
      for (const f of files) {
        const stat = await fs.stat(path.join(storageDir, f));
        console.log(JSON.stringify({ file: f, bytes: stat.size }));
      }
      console.log('fileCount:', files.length);
    } catch (e) {
      console.log('storage error:', (e as Error).message);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
