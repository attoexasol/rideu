/**
 * Simulate segment upload for a pending segment (validates upload path after booking ends).
 */
import 'dotenv/config';
import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';
import { createUploadToken } from '../services/ride-video-storage.service';

const BASE = process.env.LIVE_TEST_BASE_URL || 'http://127.0.0.1:3000';
const SESSION_ID = process.env.TRACE_SESSION_ID || '8f94075d-09ec-4dfb-b7f5-a82f5218a0a1';

async function main() {
  if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
    console.error('Missing env');
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL);
  try {
    const sessions = await sql`
      SELECT vs.id, vs.driver_id, vs.booking_id, d.auth0_id, d.email, d.name, d.active_session_id, d.active_device_id
      FROM video_sessions vs
      JOIN drivers d ON d.id = vs.driver_id
      WHERE vs.id = ${SESSION_ID}::uuid
      LIMIT 1
    `;
    const session = sessions[0];
    if (!session) {
      console.error('Session not found');
      process.exit(1);
    }

    const segments = await sql`
      SELECT id, segment_index, storage_key, mime_type, file_size, upload_status
      FROM video_segments
      WHERE session_id = ${SESSION_ID}::uuid AND upload_status = 'pending'
      ORDER BY segment_index ASC
      LIMIT 1
    `;
    const segment = segments[0];
    if (!segment) {
      console.log(JSON.stringify({ ok: false, reason: 'no_pending_segment' }));
      process.exit(0);
    }

    const buffer = Buffer.alloc(Number(segment.file_size) || 1024, 0x42);
    const { token } = createUploadToken({
      segmentId: segment.id,
      driverId: session.driver_id,
      storageKey: segment.storage_key,
    });

    const driverToken = jwt.sign(
      {
        userId: session.driver_id,
        auth0Id: session.auth0_id,
        name: session.name,
        email: session.email,
        role: 'driver',
        userType: 'driver',
        sessionId: session.active_session_id || `trace_${Date.now()}`,
        permissions: [],
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h', algorithm: 'HS256' }
    );

    const putRes = await fetch(
      `${BASE}/api/v1/driver/video/segments/${segment.id}/upload?token=${encodeURIComponent(token)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${driverToken}`,
          'Content-Type': segment.mime_type || 'video/mp4',
          'X-Device-Id': session.active_device_id || 'trace-device',
        },
        body: buffer,
      }
    );
    const putJson = (await putRes.json().catch(() => ({}))) as {
      data?: { segment?: { uploadStatus?: string } };
    };

    const completeRes = await fetch(
      `${BASE}/api/v1/driver/video/sessions/${SESSION_ID}/segments/${segment.id}/complete`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${driverToken}`,
          'Content-Type': 'application/json',
          'X-Device-Id': session.active_device_id || 'trace-device',
        },
        body: JSON.stringify({
          fileSizeBytes: buffer.length,
          checksum: createHash('sha256').update(buffer).digest('hex'),
        }),
      }
    );
    const completeJson = (await completeRes.json().catch(() => ({}))) as {
      data?: { segment?: { uploadStatus?: string } };
    };

    console.log(
      JSON.stringify(
        {
          segmentIndex: segment.segment_index,
          putStatus: putRes.status,
          putUploadStatus: putJson?.data?.segment?.uploadStatus,
          completeStatus: completeRes.status,
          completeUploadStatus: completeJson?.data?.segment?.uploadStatus,
          ok: putRes.status === 200 && completeRes.status === 200,
        },
        null,
        2
      )
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
