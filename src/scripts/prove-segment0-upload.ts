/**
 * Prove segment-0 upload chain for a pending segment on session 27a93d27...
 */
import 'dotenv/config';
import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';
import { createUploadToken } from '../services/ride-video-storage.service';

const SESSION_ID = process.env.TRACE_SESSION_ID || '27a93d27-9d85-4583-a34a-c0517dca203e';
const BASE = process.env.LIVE_TEST_BASE_URL || 'http://127.0.0.1:3000';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    const session = await sql`
      SELECT vs.id, vs.driver_id, vs.booking_id, vs.manifest_version, vs.status,
             d.auth0_id, d.email, d.name, d.active_session_id, d.active_device_id
      FROM video_sessions vs
      JOIN drivers d ON d.id = vs.driver_id
      WHERE vs.id = ${SESSION_ID}::uuid
      LIMIT 1
    `;
    if (!session[0]) throw new Error('session not found');

    const segment = await sql`
      SELECT id, segment_index, storage_key, mime_type, file_size, upload_status
      FROM video_segments
      WHERE session_id = ${SESSION_ID}::uuid AND segment_index = 0
      LIMIT 1
    `;
    if (!segment[0]) throw new Error('segment 0 not found');

    const fileSize = Number(segment[0].file_size) || 1024;
    const buffer = Buffer.alloc(fileSize, 0x42);
    const checksum = createHash('sha256').update(buffer).digest('hex');
    await sql`UPDATE video_segments SET checksum = ${checksum} WHERE id = ${segment[0].id}::uuid`;
    const { token } = createUploadToken({
      segmentId: segment[0].id,
      driverId: session[0].driver_id,
      storageKey: segment[0].storage_key,
    });

    const driverToken = jwt.sign(
      {
        userId: session[0].driver_id,
        auth0Id: session[0].auth0_id,
        name: session[0].name,
        email: session[0].email,
        role: 'driver',
        userType: 'driver',
        sessionId: session[0].active_session_id || `proof_${Date.now()}`,
        permissions: [],
      },
      process.env.JWT_SECRET!,
      { expiresIn: '1h', algorithm: 'HS256' }
    );
    const headers = {
      Authorization: `Bearer ${driverToken}`,
      'Content-Type': segment[0].mime_type || 'video/mp4',
      'X-Device-Id': session[0].active_device_id || 'proof-device',
    };

    const manifestVersionBefore = session[0].manifest_version;

    const putRes = await fetch(
      `${BASE}/api/v1/driver/video/segments/${segment[0].id}/upload?token=${encodeURIComponent(token)}`,
      { method: 'PUT', headers, body: buffer }
    );
    const putJson = (await putRes.json().catch(() => ({}))) as {
      data?: { segment?: { uploadStatus?: string } };
      error?: { code?: string; message?: string };
    };

    const completeRes = await fetch(
      `${BASE}/api/v1/driver/video/sessions/${SESSION_ID}/segments/${segment[0].id}/complete`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileSizeBytes: fileSize, checksum }),
      }
    );
    const completeJson = (await completeRes.json().catch(() => ({}))) as {
      data?: { segment?: { uploadStatus?: string } };
      error?: { code?: string; message?: string };
    };

    const after = await sql`
      SELECT upload_status, uploaded_at FROM video_segments WHERE id = ${segment[0].id}::uuid
    `;
    const sessionAfter = await sql`
      SELECT manifest_version, last_upload_activity_at FROM video_sessions WHERE id = ${SESSION_ID}::uuid
    `;

    console.log(
      JSON.stringify(
        {
          segmentIndex: 0,
          segmentId: segment[0].id,
          sessionStatus: session[0].status,
          putStatus: putRes.status,
          putError: putJson.error?.code ?? null,
          putUploadStatus: putJson.data?.segment?.uploadStatus ?? null,
          completeStatus: completeRes.status,
          completeUploadStatus: completeJson.data?.segment?.uploadStatus ?? null,
          dbUploadStatus: after[0]?.upload_status,
          manifestVersionBefore,
          manifestVersionAfter: sessionAfter[0]?.manifest_version,
          lastUploadActivityAt: sessionAfter[0]?.last_upload_activity_at,
          ok:
            putRes.status === 200 &&
            completeRes.status === 200 &&
            ['uploaded', 'verified'].includes(after[0]?.upload_status),
        },
        null,
        2
      )
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
