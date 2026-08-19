import 'dotenv/config';
import { createAdminPlaybackManifest } from '../services/adminRideVideo.service';

const SESSION_ID = '27a93d27-9d85-4583-a34a-c0517dca203e';

createAdminPlaybackManifest(SESSION_ID)
  .then((m) =>
    console.log(
      JSON.stringify({
        ok: true,
        manifestVersion: m.manifestVersion,
        segmentCount: m.segments?.length ?? 0,
        liveEdgeSeconds: m.liveEdgeSeconds,
        availableDurationSeconds: m.availableDurationSeconds,
      })
    )
  )
  .catch((e) => console.log(JSON.stringify({ ok: false, code: e.code, message: e.message })));
