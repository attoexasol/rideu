"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const postgres_1 = __importDefault(require("postgres"));
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ── Config ──────────────────────────────────────────────────────────────────
const AUTH0_DOMAIN = 'dev-3t82y4zqjstv66qp.us.auth0.com';
const AUTH0_MGMT_CLIENT_ID = 'rjWwtSrC1rWZwkgz2EpNetoVQGHLsJEN';
const AUTH0_MGMT_CLIENT_SECRET = '0LeWmq9oH8nCVAtn5unhkkoEQUrZUkIT7qKIw-55J6jfryECf5VYT42hzm6hbe3u';
const DATABASE_URL = 'postgresql://postgres:zZEzdQIcIcumpgTLogbWZGnLVdHfUOLq@tramway.proxy.rlwy.net:32928/railway';
// ── Driver Data ─────────────────────────────────────────────────────────────
// Format: [name, cabName, cabNumber, phone]
const DRIVERS = [
    ['Abdul', 'Faras Cab', '4081', '619-576-5971'],
    ['Ibrahim Golis', 'Golis Cab', '349', '619-865-1198'],
    ['Ibrahim Golis', 'Golis Cab', '355', '619-865-1198'],
    ['Ibrahim Golis', 'Golis Cab', '636', '619-865-1198'],
    ['Fekadu Hirtada', '2B1AMBO Cab', '638', '619-301-4636'],
    ['Alem M. Akebari', 'AAA Cab', '418', '619-559-5249'],
    ['Baldomero Rodriguez', "Acosta's Cab", '4283', '619-495-0253'],
    ['Alem Istafanos', 'AI Cab', '143', '619-857-3513'],
    ['Santiago Alvarez', 'Alvarez Cab', '4284', '619-571-5618'],
    ['Pablo Luz', 'America Cab', '377', '619-579-5594'],
    ['Mahruddin Khawaja', 'Country Cab', '956', '858-232-9084'],
    ['Yakov Badalov', 'Daniel Cab', '259', '619-200-4919'],
    ['Yakov Badalov', 'BK Cab', '285', '619-200-4919'],
    ['David Osuna Perez', 'Davis Cab', '4153', '619-289-6820'],
    ['Rahim Ismael', 'East County Cab', '3246', '619-888-1150'],
    ['Sima Adhami', 'Fancy Limo Cab', '1006', '858-610-1940'],
    ['Sima Adhami', 'Fancy Limo Cab', '901', '858-610-1940'],
    ['Ezzadin Abduwahab Fato', 'Oromia Cab', '34', '619-549-0434'],
    ['Ezzadin Abduwahab Fato', 'Oromia Cab', '217', '619-549-0434'],
    ['Francisco Maldonado Perez', 'Pancho Cab', '4211', '619-665-3482'],
    ['Estiphanos Senbet', 'Halhale Cab', '1088', '619-200-4916'],
    ['Estiphanos Senbet', 'Halhale Cab', '192', '619-200-4916'],
    ['Estiphanos Senbet', 'Halhale Cab', '22', '619-200-4916'],
    ['Ramon Ibarra', 'Ibarra Cab', '92', '619-591-6653'],
    ['Gonzalo Santiago Estrada', 'Israel Cab', '791', '619-888-2643'],
    ['Lutfi Ahmed', 'JAM Cab', '226', '619-342-6494'],
    ['Lutfi Ahmed', 'JAM Cab', '26', '619-342-6494'],
    ['Lutfi Ahmed', 'JAM Cab', '326', '619-342-6494'],
    ['Lutfi Ahmed', 'JAM Cab', '426', '619-342-6494'],
    ['Alfred Banks', 'Constant Cab', '328', '619-313-1052'],
    ['Alfred Banks', 'Constant Cab', '4322', '619-313-1052'],
    ['Alfred Banks', 'Constant Cab', '4324', '619-313-1052'],
    ['Alfred Banks', 'Constant Cab', '4355', '619-313-1052'],
    ['Alfred Banks', 'Constant Cab', '44', '619-313-1052'],
    ['Alfred Banks', 'Constant Cab', '48', '619-313-1052'],
    ['Alfred Banks', 'Constant Cab', '694', '619-313-1052'],
    ['Alfred Banks', 'Constant Cab', '156', '619-313-1052'],
    ['Alfred Banks', 'Constant Cab', '157', '619-313-1052'],
    ['Alfred Banks', 'Constant Cab', '158', '619-313-1052'],
    ['Oleg Vavilov', 'Last Taxi', '480', '619-415-7414'],
    ['Boris Davydov', 'Lederer Cab', '435', '619-307-9290'],
    ['Legesse Mebrahta', 'LES Cab', '120', '619-930-2362'],
    ['Bekele Kefyalew', 'M+N Cab', '205', '619-906-1008'],
    ['Medh Woldekidran', 'Med Cab', '180', '619-343-5031'],
    ['Habtu Medired', 'Mendeferra Cab', '855', '619-372-5437'],
    ['Abera Aboye', 'Meteroite Cab', '4052', '619-315-8036'],
    ['Amsulu Daba', 'Milki Cab', '4328', '619-713-8197'],
    ['Hassan', 'Mumin Cab', '4309', '619-495-2654'],
    ['Otabek Hudoinberdiev', 'New Way Cab', '202', '619-481-7144'],
    ['Otabek Hudoinberdiev', 'New Way Cab', '4133', '619-481-7144'],
    ['Teferi Teshome', 'Niyala Cab', '4348', '619-508-5441'],
    ['Muhsin Nur', 'Nur Cab', '237', '619-432-9977'],
    ['Jimmy Haronres', 'On The Fly Cab', '822', '619-818-5868'],
    ['Ahmed Farah', 'Open Cab', '525', '619-623-0994'],
    ['Armando Cruz Conseca', 'Armando Cab', '4288', '619-288-0917'],
    ['Isaiahs Arroyo', 'Arroyo Cab', '55', '619-638-0654'],
    ['Flavio Oliveira', 'Astro Cab', '361', '619-995-7903'],
    ['Flavio Oliveira', 'Astro Cab', '4361', '619-995-7903'],
    ['Mohamud Omar', 'Black Cab', '72', '619-451-8030'],
    ['Maygel Hakim', 'CA Blue Cab', '4285', '619-894-5070'],
    // Daniel Fesshaye has cab 261 listed twice with different phones — using first phone
    ['Daniel Fesshaye', 'Celebrity Cab', '261', '619-930-3055'],
    ['Gary Ghile', 'Coast Cab', '235', '619-607-1275'],
    ['Gary Ghile', 'Coast Cab', '775', '619-607-1275'],
];
// ── Helpers ─────────────────────────────────────────────────────────────────
function generatePassword() {
    // 16-char random string with mixed case, digits, and symbols (Auth0-compliant)
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*';
    let pw = '';
    const bytes = crypto_1.default.randomBytes(16);
    for (let i = 0; i < 16; i++) {
        pw += chars[bytes[i] % chars.length];
    }
    // Ensure at least one of each category
    pw = 'A' + 'a' + '1' + '!' + pw.slice(4);
    return pw;
}
function makeEmail(cabName, cabNumber) {
    const slug = cabName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '') // strip non-alphanumeric
        .slice(0, 30);
    return `${slug}.${cabNumber}@drivers.drivewize.com`;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// ── Auth0 ───────────────────────────────────────────────────────────────────
let mgmtToken = null;
async function getManagementToken() {
    if (mgmtToken)
        return mgmtToken;
    const res = await axios_1.default.post(`https://${AUTH0_DOMAIN}/oauth/token`, {
        client_id: AUTH0_MGMT_CLIENT_ID,
        client_secret: AUTH0_MGMT_CLIENT_SECRET,
        audience: `https://${AUTH0_DOMAIN}/api/v2/`,
        grant_type: 'client_credentials',
    });
    mgmtToken = res.data.access_token;
    return mgmtToken;
}
async function getDriverRoleId() {
    const token = await getManagementToken();
    const res = await axios_1.default.get(`https://${AUTH0_DOMAIN}/api/v2/roles`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const role = res.data.find((r) => r.name.toLowerCase() === 'driver');
    if (!role)
        throw new Error('Driver role not found in Auth0. Create it first in the Dashboard.');
    return role.id;
}
async function createAuth0User(email, password, name) {
    const token = await getManagementToken();
    const res = await axios_1.default.post(`https://${AUTH0_DOMAIN}/api/v2/users`, {
        email,
        password,
        connection: 'Username-Password-Authentication',
        email_verified: true,
        name,
        app_metadata: { role: 'driver' },
    }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    return res.data.user_id; // e.g. "auth0|abc123"
}
async function assignRole(userId, roleId) {
    const token = await getManagementToken();
    await axios_1.default.post(`https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}/roles`, { roles: [roleId] }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
}
// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
    console.log('🚀 Starting driver seed...\n');
    // Connect to Railway Postgres
    const sql = (0, postgres_1.default)(DATABASE_URL, { max: 5, idle_timeout: 20 });
    // Verify DB connection
    const [{ now }] = await sql `SELECT now()`;
    console.log(`✅ Database connected (server time: ${now})\n`);
    // Get Auth0 driver role ID
    const driverRoleId = await getDriverRoleId();
    console.log(`✅ Auth0 driver role ID: ${driverRoleId}\n`);
    // Deduplicate by cabName+cabNumber (handles the Daniel Fesshaye duplicate)
    const seen = new Set();
    const uniqueDrivers = [];
    for (const entry of DRIVERS) {
        const key = `${entry[1]}|${entry[2]}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueDrivers.push(entry);
        }
    }
    console.log(`📋 ${uniqueDrivers.length} unique cab accounts to create\n`);
    // CSV header
    const csvRows = ['Name,Cab Name,Cab Number,Phone,Email,Password,Auth0 ID,DB ID,Status'];
    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < uniqueDrivers.length; i++) {
        const [name, cabName, cabNumber, phone] = uniqueDrivers[i];
        const email = makeEmail(cabName, cabNumber);
        const password = generatePassword();
        console.log(`[${i + 1}/${uniqueDrivers.length}] ${name} — ${cabName} #${cabNumber}`);
        try {
            // 1. Create Auth0 user
            const auth0Id = await createAuth0User(email, password, name);
            console.log(`   ✅ Auth0: ${auth0Id}`);
            // 2. Assign driver role
            try {
                await assignRole(auth0Id, driverRoleId);
                console.log(`   ✅ Role assigned`);
            }
            catch (roleErr) {
                console.log(`   ⚠️  Role assignment failed (app_metadata fallback): ${roleErr.message}`);
            }
            // 3. Insert into database
            const [row] = await sql `
        INSERT INTO drivers (
          id, auth0_id, email, name, phone, status,
          cab_name, cab_number,
          created_at, updated_at
        ) VALUES (
          gen_random_uuid(),
          ${auth0Id},
          ${email},
          ${name},
          ${phone},
          'offline',
          ${cabName},
          ${cabNumber},
          now(),
          now()
        )
        RETURNING id
      `;
            console.log(`   ✅ DB: ${row.id}`);
            csvRows.push(`"${name}","${cabName}","${cabNumber}","${phone}","${email}","${password}","${auth0Id}","${row.id}","success"`);
            successCount++;
        }
        catch (err) {
            const msg = err.response?.data?.message || err.message;
            console.log(`   ❌ FAILED: ${msg}`);
            csvRows.push(`"${name}","${cabName}","${cabNumber}","${phone}","${email}","${password}","","","FAILED: ${msg.replace(/"/g, '""')}"`);
            failCount++;
        }
        // Rate limit: Auth0 Management API allows ~2 req/s on free tier
        await sleep(1500);
    }
    // Write CSV
    const csvPath = path_1.default.resolve(__dirname, '../../driver-accounts.csv');
    fs_1.default.writeFileSync(csvPath, csvRows.join('\n'), 'utf-8');
    console.log(`\n📄 CSV written to: ${csvPath}`);
    console.log(`\n✅ Done! ${successCount} created, ${failCount} failed.`);
    await sql.end();
}
main().catch((err) => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=seed-drivers.js.map