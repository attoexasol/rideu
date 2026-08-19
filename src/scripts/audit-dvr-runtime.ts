/**
 * Read-only DVR runtime audit — do not modify data.
 */
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import postgres from 'postgres';
import { videoConfig } from '../config/video';
import { inspectPrivateSegment } from '../services/ride-video-storage.service';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    const sessions = await sql`
      SELECT vs.id, vs.booking_id, vs.driver_id, vs.passenger_id, vs.status,
             vs.consent_status, vs.manifest_version, vs.last_upload_activity_at,
             vs.started_at, vs.finalized_at, vs.ended_at, vs.failure_reason,
             vs.created_at, vs.updated_at,
             b.status AS booking_status, b.booking_number
      FROM video_sessions vs
      JOIN bookings b ON b.id = vs.booking_id
      ORDER BY vs.created_at DESC
      LIMIT 5
    `;
    console.log('=== RECENT SESSIONS (top 5) ===');
    console.log(JSON.stringify(sessions, null, 2));

    const session = sessions[0];
    if (!session) {
      console.log('NO_SESSIONS');
      return;
    }

    const segments = await sql`
      SELECT id, segment_index, client_segment_id, upload_status, storage_key,
             duration_ms, file_size, mime_type, checksum,
             recorded_at, uploaded_at, retry_count, failure_reason,
             retention_deleted_at, created_at, updated_at
      FROM video_segments
      WHERE session_id = ${session.id}::uuid
      ORDER BY segment_index ASC
    `;

    const counts = {
      pending: 0,
      uploading: 0,
      uploaded: 0,
      verified: 0,
      failed: 0,
      other: 0,
    };
    let storageFiles = 0;
    const segmentDetails = [];
    for (const s of segments) {
      const st = s.upload_status as keyof typeof counts;
      if (st in counts) counts[st as 'pending'] += 1;
      else counts.other += 1;
      let storageExists = false;
      let storageSize = 0;
      if (s.storage_key) {
        const obj = await inspectPrivateSegment(s.storage_key);
        storageExists = obj != null;
        storageSize = obj?.fileSizeBytes ?? 0;
        if (storageExists) storageFiles += 1;
      }
      segmentDetails.push({
        segmentIndex: s.segment_index,
        segmentId: s.id,
        uploadStatus: s.upload_status,
        durationMs: s.duration_ms,
        fileSize: s.file_size,
        storageKey: s.storage_key,
        storageExists,
        storageSizeBytes: storageSize,
        retryCount: s.retry_count,
        recordedAt: s.recorded_at,
        uploadedAt: s.uploaded_at,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        failureReason: s.failure_reason,
        hasChecksum: Boolean(s.checksum),
      });
    }

    console.log('\n=== LATEST SESSION SUMMARY ===');
    console.log(
      JSON.stringify(
        {
          bookingId: session.booking_id,
          sessionId: session.id,
          driverId: session.driver_id,
          bookingStatus: session.booking_status,
          sessionStatus: session.status,
          manifestVersion: session.manifest_version,
          startedAt: session.started_at,
          finalizedAt: session.finalized_at,
          lastUploadActivityAt: session.last_upload_activity_at,
          segmentTotal: segments.length,
          counts,
          storageFilesOnDisk: storageFiles,
        },
        null,
        2
      )
    );

    console.log('\n=== ALL SEGMENTS ===');
    for (const d of segmentDetails) console.log(JSON.stringify(d));

    const seg0 = segmentDetails.find((s) => s.segmentIndex === 0);
    console.log('\n=== SEGMENT 0 ===');
    console.log(JSON.stringify(seg0 ?? null));

    const storageDir = path.join(
      videoConfig.storageRoot,
      videoConfig.storageContainer,
      session.booking_id,
      session.id
    );
    console.log('\n=== STORAGE DIR ===', storageDir);
    try {
      const files = await fs.readdir(storageDir);
      for (const f of files) {
        const stat = await fs.stat(path.join(storageDir, f));
        console.log(JSON.stringify({ file: f, bytes: stat.size }));
      }
      console.log('fileCount:', files.length);
    } catch (e) {
      console.log('storageError:', (e as Error).message);
    }

    console.log('\n=== VIDEO CONFIG ===');
    console.log(
      JSON.stringify({
        maxSegmentSizeBytes: videoConfig.maxSegmentSizeBytes,
        uploadUrlTtlSeconds: videoConfig.uploadUrlTtlSeconds,
        segmentDurationSeconds: videoConfig.segmentDurationSeconds,
        storageRoot: videoConfig.storageRoot,
        apiPublicBaseUrl: videoConfig.apiPublicBaseUrl || null,
        videoSigningSecretSet: Boolean(process.env.VIDEO_SIGNING_SECRET),
        jwtSecretSet: Boolean(process.env.JWT_SECRET),
      })
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
