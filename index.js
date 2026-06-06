'use strict';

// Load environment variables
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const twilio = require('twilio');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ============================================================
// KONFIGURASI
// ============================================================
const API_KEY_JAGEL = process.env.JAGEL_APIKEY || "c6wA9HlUkN2PYEpEOYmDwiehrw7QMIVAvPETMpR2NRN4jjnYPO";
const JAGEL_BASE_URL = process.env.JAGEL_BASE_URL || "https://api.jagel.id/v1";

const CONFIG = {
    clientId: process.env.LINKQU_CLIENT_ID || 'testing',
    clientSecret: process.env.LINKQU_CLIENT_SECRET || '123',
    username: process.env.LINKQU_USERNAME || 'LI307GXIN',
    pin: process.env.LINKQU_PIN || '2K2NPCBBNNTovgB',
    serverKey: process.env.LINKQU_SERVER_KEY || 'LinkQu@2020',
    callbackUrl: process.env.CALLBACK_URL || 'https://jagel.siappgo.id/callback',
    jagelApiKey: process.env.JAGEL_APIKEY || 'q2t7lktZkZIEiCDs7y9HpWP0WCRdABEGTrHidEUhrAMe0IDzXV',
    linkquGateway: process.env.LINKQU_GATEWAY || 'https://gateway-dev.linkqu.id/linkqu-partner',
    jagelBaseUrl: process.env.JAGEL_BASE_URL || 'https://api.jagel.id/v1',
    port: parseInt(process.env.PORT || '3000'),

    // Twilio Configuration
    twilioSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuth: process.env.TWILIO_AUTH_TOKEN || '',
    twilioWaNumber: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
    csNumber: process.env.CS_PHONE_NUMBER || '6282226666610',

    // Twilio Template SIDs
    templateDriverConfirmation: process.env.TWILIO_TEMPLATE_DRIVER_CONFIRMATION || 'HX0f899a4bc82aca9611ef757228c3ba61',
    templateDriverOrderAccepted: process.env.TWILIO_TEMPLATE_DRIVER_ACCEPTED || 'HX59e4eb4a2e31316585b76a3fbb2bfc8d',
    templateCustomerOrderConfirmed: process.env.TWILIO_TEMPLATE_CUSTOMER_CONFIRMED || 'HX9e996a15a5f28fb3ec2cdd7d84ab85a2',
    templateDriverRejected: process.env.TWILIO_TEMPLATE_DRIVER_REJECTED || 'HX883e49ca163a114e5674f0be7dd53bec',
    templateNoDriverAvailable: process.env.TWILIO_TEMPLATE_NO_DRIVER || 'HX83dfee2050db21b4b4ffc571c31690da'
};

// ============================================================
// TWILIO INITIALIZATION
// ============================================================
let twilioClient = null;

function initTwilio() {
    console.log('\n🔧 [TWILIO] Initializing...');
    if (!CONFIG.twilioSid || !CONFIG.twilioAuth) {
        console.error('❌ TWILIO CREDENTIALS MISSING!');
        return null;
    }
    try {
        twilioClient = twilio(CONFIG.twilioSid, CONFIG.twilioAuth);
        console.log('✅ Twilio client initialized');
        return twilioClient;
    } catch (error) {
        console.error('❌ Twilio init failed:', error.message);
        return null;
    }
}
initTwilio();

// ============================================================
// DATABASE POOL
// ============================================================
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'e8gsoo4w4gg8oo4s8skscowo',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'IvlI9h6kMJfOGOov6YYpuCdQ3fOcITZ59iDmw225iJwtV9aVOTUDTzxHlTa7pOjN',
    database: process.env.DB_NAME || 'orderwa',
    port: parseInt(process.env.DB_PORT || '3306'),
    connectTimeout: 30000,
    connectionLimit: 10,
    waitForConnections: true,
});

// ============================================================
// GLOBAL VARIABLES
// ============================================================
const driverConfirmations = new Map();
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function logToFile(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const logPath = path.join(LOG_DIR, `${type.toLowerCase()}.log`);
    fs.appendFile(logPath, `[${timestamp}] [${type}] ${message}\n`, (err) => {
        if (err) console.error('Log error:', err.message);
    });
    console.log(message);
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function mysqlNow() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function generatePartnerReff() {
    return `INV-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function getExpiredTimestamp(minutes = 15) {
    return moment.tz('Asia/Jakarta').add(minutes, 'minutes').format('YYYYMMDDHHmmss');
}

function generateCustomerId() {
    return Date.now().toString().slice(-5) + Math.floor(Math.random() * 90000 + 10000);
}

function hmac256(serverKey, data) {
    return crypto.createHmac('sha256', serverKey).update(data).digest('hex');
}

function cleanValue(str) {
    return String(str).replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
}

function generateSignatureVA(p) {
    const raw = cleanValue(p.amount + p.expired + p.bank_code + p.partner_reff + p.customer_id + p.customer_name + p.customer_email + p.clientId);
    return hmac256(p.serverKey, '/transaction/create/vaPOST' + raw);
}

function generateSignatureQRIS(p) {
    const raw = cleanValue(p.amount + p.expired + p.partner_reff + p.customer_id + p.customer_name + p.customer_email + p.clientId);
    return hmac256(p.serverKey, '/transaction/create/qrisPOST' + raw);
}

function normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;
    let cleaned = phoneNumber.toString().replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '62' + cleaned.substring(1);
    if (!cleaned.startsWith('62')) cleaned = '62' + cleaned;
    return cleaned;
}

function formatWhatsAppNumber(phoneNumber) {
    if (!phoneNumber) return null;
    let cleaned = normalizePhoneNumber(phoneNumber);
    return cleaned ? `whatsapp:${cleaned}` : null;
}

function formatRupiah(amount) {
    if (!amount) return 'Rp 0';
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
}

function parsePrice(price) {
    if (price === null || price === undefined) return 0;
    if (typeof price === 'number') return price;
    let priceStr = String(price).replace(/[Rr][Pp]\s*/g, '').replace(/[$,]/g, '').replace(/\./g, '').replace(/,/g, '.');
    const parsed = parseFloat(priceStr);
    return isNaN(parsed) ? 0 : parsed;
}

// ============================================================
// ADD BALANCE KE AKUN "amir"
// ============================================================
async function addBalanceToAmir(amount, customerName, methodCode, serialNumber) {
    const originalAmount = parseInt(amount);
    let admin = methodCode === 'QRIS' ? Math.round(originalAmount * 0.008) : 4000;
    const netAmount = originalAmount - admin;
    const username = 'amir';
    const note = `Pembayaran dari ${customerName} || Rp ${netAmount.toLocaleString('id-ID')} (admin ${admin.toLocaleString('id-ID')}) || ${methodCode} || Reff: ${serialNumber}`;

    console.log(`💰 [ADD-BALANCE] ${customerName} -> ${username} | Amount: ${netAmount} | Admin: ${admin}`);

    try {
        const response = await axios.post(`${CONFIG.jagelBaseUrl}/balance/adjust`, {
            action: 'adjust_balance',
            type: 'username',
            value: username,
            amount: netAmount,
            note: note,
            apikey: CONFIG.jagelApiKey
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });

        console.log('✅ Balance added:', response.data);
        return { success: true, data: response.data };
    } catch (error) {
        console.error('❌ Add balance failed:', error.message);
        throw error;
    }
}

// ============================================================
// TWILIO SEND FUNCTIONS
// ============================================================
async function sendWhatsAppTemplate(to, templateSid, variables) {
    if (!twilioClient) return { success: false, error: 'Twilio not initialized' };
    const whatsappTo = formatWhatsAppNumber(to);
    if (!whatsappTo) return { success: false, error: 'Invalid phone number' };
    if (!templateSid || !templateSid.startsWith('HX')) return { success: false, error: 'Invalid template SID' };
    try {
        const result = await twilioClient.messages.create({
            from: CONFIG.twilioWaNumber,
            to: whatsappTo,
            contentSid: templateSid,
            contentVariables: JSON.stringify(variables)
        });
        return { success: true, sid: result.sid };
    } catch (error) {
        console.error('❌ Twilio error:', error.message);
        return { success: false, error: error.message };
    }
}

async function sendWhatsAppFreeForm(to, message) {
    if (!twilioClient) return { success: false, error: 'Twilio not initialized' };
    const whatsappTo = formatWhatsAppNumber(to);
    if (!whatsappTo) return { success: false, error: 'Invalid phone number' };
    try {
        const result = await twilioClient.messages.create({
            from: CONFIG.twilioWaNumber,
            to: whatsappTo,
            body: message
        });
        return { success: true, sid: result.sid };
    } catch (error) {
        console.error('❌ Free-form error:', error.message);
        return { success: false, error: error.message };
    }
}

// ============================================================
// DATABASE TEST
// ============================================================
let dbReady = false;
(async function testDb() {
    try {
        const conn = await pool.getConnection();
        console.log('✅ Database connected');
        conn.release();
        dbReady = true;
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
        dbReady = false;
    }
})();

// ============================================================
// CALL JAGEL API HELPER
// ============================================================
async function callJagelAppApi(url, bearerToken, method = 'GET', data = null) {
    const config = {
        method, url,
        headers: {
            'Authorization': `Bearer ${bearerToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        },
        timeout: 30000,
        httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
    };
    if (method === 'POST' && data) config.data = data;
    console.log(`🌐 [JAGEL-APP-API] ${method} ${url}`);
    const response = await axios(config);
    return response;
}

// ============================================================
// ENDPOINT: POST /create-va
// ============================================================
app.post('/create-va', async (req, res) => {
    console.log('\n📝 [CREATE-VA] Request:', JSON.stringify(req.body, null, 2));
    if (!dbReady) return res.status(503).json({ error: 'Database not ready' });

    try {
        const body = req.body;
        const customerId = body.customer_id || generateCustomerId();
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();
        const bankCode = body.bank_code || '008';

        const signature = generateSignatureVA({
            amount: body.amount, expired, bank_code: bankCode, partner_reff,
            customer_id: customerId, customer_name: body.customer_name,
            customer_email: body.customer_email, clientId: CONFIG.clientId, serverKey: CONFIG.serverKey
        });

        const payload = {
            amount: body.amount, bank_code: bankCode, customer_id: customerId,
            customer_name: body.customer_name, customer_email: body.customer_email,
            customer_phone: body.customer_phone || '', partner_reff, username: CONFIG.username,
            pin: CONFIG.pin, expired, signature, url_callback: CONFIG.callbackUrl,
            remark: `VA ${bankCode}`
        };

        const response = await axios.post(`${CONFIG.linkquGateway}/transaction/create/va`, payload, {
            headers: { 'client-id': CONFIG.clientId, 'client-secret': CONFIG.clientSecret }, timeout: 30000
        });

        const result = response.data;
        const vaNumber = result.virtual_account || null;
        const isSuccess = result.status === 'SUCCESS' || result.response_code === '00';

        await pool.execute(
            `INSERT INTO inquiry_va (partner_reff, customer_name, customer_phone, customer_email, bank_code, va_number, amount, expired, response_raw, created_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [partner_reff, body.customer_name, body.customer_phone || null, body.customer_email, bankCode, vaNumber, body.amount, expired, JSON.stringify(result), mysqlNow(), isSuccess ? 'PENDING' : 'FAILED']
        );

        res.json({ ...result, partner_reff, customer_id: customerId, db_saved: true });
    } catch (err) {
        console.error('❌ [CREATE-VA] Error:', err.message);
        res.status(500).json({ error: 'Failed to create VA', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /create-qris
// ============================================================
app.post('/create-qris', async (req, res) => {
    console.log('\n📝 [CREATE-QRIS] Request:', JSON.stringify(req.body, null, 2));
    if (!dbReady) return res.status(503).json({ error: 'Database not ready' });

    try {
        const body = req.body;
        const customerId = body.customer_id || generateCustomerId();
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();

        const signature = generateSignatureQRIS({
            amount: body.amount, expired, partner_reff, customer_id: customerId,
            customer_name: body.customer_name, customer_email: body.customer_email,
            clientId: CONFIG.clientId, serverKey: CONFIG.serverKey
        });

        const payload = {
            amount: body.amount, customer_id: customerId, customer_name: body.customer_name,
            customer_email: body.customer_email, customer_phone: body.customer_phone || '',
            partner_reff, username: CONFIG.username, pin: CONFIG.pin, expired, signature,
            url_callback: CONFIG.callbackUrl
        };

        const response = await axios.post(`${CONFIG.linkquGateway}/transaction/create/qris`, payload, {
            headers: { 'client-id': CONFIG.clientId, 'client-secret': CONFIG.clientSecret }, timeout: 30000
        });

        const result = response.data;
        let qrisImageBuffer = null;
        if (result?.imageqris) {
            try {
                const imgResp = await axios.get(result.imageqris.trim(), { responseType: 'arraybuffer', timeout: 10000 });
                qrisImageBuffer = Buffer.from(imgResp.data);
            } catch (imgErr) { console.warn('QR image download failed:', imgErr.message); }
        }

        const isSuccess = result.status === 'SUCCESS' || result.response_code === '00';

        await pool.execute(
            `INSERT INTO inquiry_qris (partner_reff, customer_id, customer_name, amount, expired, customer_phone, customer_email, qris_url, qris_image, response_raw, created_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [partner_reff, customerId, body.customer_name, body.amount, expired, body.customer_phone || null, body.customer_email, result?.imageqris || null, qrisImageBuffer, JSON.stringify(result), mysqlNow(), isSuccess ? 'PENDING' : 'FAILED']
        );

        res.json({ ...result, partner_reff, customer_id: customerId, db_saved: true });
    } catch (err) {
        console.error('❌ [CREATE-QRIS] Error:', err.message);
        res.status(500).json({ error: 'Failed to create QRIS', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: GET /check-status/:partner_reff
// ============================================================
app.get('/check-status/:partner_reff', async (req, res) => {
    const { partner_reff } = req.params;

    console.log(`\n🔍 [CHECK-STATUS] Checking: ${partner_reff}`);

    if (!partner_reff) {
        return res.status(400).json({ rc: '01', message: 'partner_reff diperlukan' });
    }

    try {
        let transaction = null;

        let [rows] = await pool.execute(
            `SELECT partner_reff, status, amount, bank_code as method, created_at 
             FROM inquiry_va 
             WHERE partner_reff = ?`,
            [partner_reff]
        );

        if (rows.length > 0) {
            transaction = { ...rows[0], type: 'VA' };
        }

        if (!transaction) {
            [rows] = await pool.execute(
                `SELECT partner_reff, status, amount, created_at 
                 FROM inquiry_qris 
                 WHERE partner_reff = ?`,
                [partner_reff]
            );
            if (rows.length > 0) {
                transaction = { ...rows[0], type: 'QRIS', method: 'QRIS' };
            }
        }

        if (!transaction) {
            console.log(`❌ Transaction not found: ${partner_reff}`);
            return res.status(404).json({ rc: '404', message: 'Transaksi tidak ditemukan', data: null });
        }

        const status_trx = transaction.status === 'SUKSES' ? 'success' : 'pending';

        res.json({
            rc: '00', message: 'Success',
            data: { ...transaction, status_trx, checked_at: new Date().toISOString() }
        });
    } catch (err) {
        console.error('❌ [CHECK-STATUS] Error:', err.message);
        res.status(500).json({ rc: '99', message: 'Internal server error', error: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /callback (PAYMENT CALLBACK - TAMBAH SALDO KE AMIR)
// ============================================================
app.post('/callback', async (req, res) => {
    console.log('\n📞 [CALLBACK] Received:', JSON.stringify(req.body, null, 2));

    const { partner_reff, serialnumber, status, transaction_status } = req.body;
    const finalPartnerReff = partner_reff || serialnumber;

    if (!finalPartnerReff) {
        console.error('❌ Missing partner_reff');
        return res.status(400).json({ error: 'partner_reff wajib ada' });
    }

    const connection = await pool.getConnection();
    let tableName = null;
    let dbData = null;

    try {
        await connection.beginTransaction();

        let [rows] = await connection.execute(
            `SELECT status, customer_name, amount, bank_code as method_code, 'VA' as type FROM inquiry_va WHERE partner_reff = ? FOR UPDATE`,
            [finalPartnerReff]
        );
        if (rows.length > 0) {
            tableName = 'inquiry_va';
            dbData = rows[0];
        }

        if (!tableName) {
            [rows] = await connection.execute(
                `SELECT status, customer_name, amount, 'QRIS' as method_code, 'QRIS' as type FROM inquiry_qris WHERE partner_reff = ? FOR UPDATE`,
                [finalPartnerReff]
            );
            if (rows.length > 0) {
                tableName = 'inquiry_qris';
                dbData = rows[0];
            }
        }

        if (!tableName || !dbData) {
            await connection.rollback();
            console.error(`❌ Transaction not found: ${finalPartnerReff}`);
            return res.status(404).json({ error: 'Data transaksi tidak ditemukan' });
        }

        const isPaid = status === 'SUCCESS' || status === 'SUKSES' || transaction_status === 'SUCCESS' || dbData.status === 'SUKSES';

        if (dbData.status === 'SUKSES') {
            await connection.rollback();
            console.log(`ℹ️ Already processed: ${finalPartnerReff}`);
            return res.json({ message: 'Sudah diproses sebelumnya.' });
        }

        if (isPaid) {
            await connection.execute(`UPDATE ${tableName} SET status = 'SUKSES' WHERE partner_reff = ?`, [finalPartnerReff]);
            await connection.commit();
            console.log(`✅ Payment confirmed for ${finalPartnerReff}`);

            const methodCode = dbData.method_code === 'QRIS' ? 'QRIS' : 'VA';
            await addBalanceToAmir(dbData.amount, dbData.customer_name, methodCode, finalPartnerReff);
            console.log(`🎉 Saldo ditambahkan ke akun amir: Rp ${dbData.amount} dari ${dbData.customer_name}`);
            res.json({ success: true, message: 'Callback processed, balance added to amir' });
        } else {
            await connection.commit();
            console.log(`ℹ️ Payment not confirmed yet for ${finalPartnerReff}`);
            res.json({ success: false, message: 'Payment not confirmed yet' });
        }
    } catch (err) {
        console.error(`❌ [CALLBACK] Error:`, err.message);
        try { await connection.rollback(); } catch (e) { }
        res.status(500).json({ error: 'Internal Server Error', detail: err.message });
    } finally {
        connection.release();
    }
});

// ============================================================
// ENDPOINT: GET /drivers (SSE for drivers)
// ============================================================
app.get('/drivers', async (req, res) => {
    const HARDCODED_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6IjEzODE1NmI0Y2U1NGQxYmY2ZWRkNjllYmU5NjYxYzI3MmIxMjY4NDY5NDUzZjdhMjBjOWM0MWQ1ODNmODAzZjQwOGQ4MzdiN2Y2OGVjYTIzIn0.eyJhdWQiOiIxIiwianRpIjoiMTM4MTU2YjRjZTU0ZDFiZjZlZGQ2OWViZTk2NjFjMjcyYjEyNjg0Njk0NTNmN2EyMGM5YzQxZDU4M2Y4MDNmNDA4ZDgzN2I3ZjY4ZWNhMjMiLCJpYXQiOjE3ODA0OTE1NDEsIm5iZiI6MTc4MDQ5MTU0MSwiZXhwIjoxODEyMDI3NTQxLCJzdWIiOiIyOTcxODQ0Iiwic2NvcGVzIjpbXX0.V3nZisKH-lmfEmf0iqyRmadupFf8nVL5VbpxyBZ_Y7baoA2Q5yoposdHjmokbZqLEZ-a9dL0S2nINPNE9zxdjfU7tmY1Awz24Ii7mOkaQL8dz2680SY5S2raqiWiLn7vYNinTKiA2juWvKMFVvFkfH1PnKQQ_L7nGBW3ReQ0kQg4AbqAj5z1XcfDtuZ9NPLB0QupNsdIkSBz-bliNR3aX9YjL9pzv6aszKSzRYQZni2FT0URQKvPk9B0MXTpFDzKqjURlvkFrN-jpoiV6LSzBlIBuyR5rTf3seU9vPgGDLkDLX9sm7QO8vK7TKBl40TQjbmHT9KE7pQAM-JsPw5QyeJkSpXXNcRnpm1i0Pq8lrJUeAHlyE6j2iIsLoZKtUrQAI2rAdYUjwGFoo6N26c9rbZIEeibNUdSPco68oYY_BqKYoK4kGmzGCkUV1HrZopDhcrNfhDYZEiZtNgkNAiKRpjPXblMIeN7tGjORn29DXqxspGio2DhhNIEex-Ih3a5yaW39EgDVgWS2eDBTV0A6u3ZAJkxPctNkVkxehuxSCYVjnAv6dVjKcypzJQLmMXT77VAQ7hOrrd-_iO5cliCtkyoPjkVDYxEZ9bjAaFwkb7xVKdULFSwAyYzvKYas_-tG3mEvhcUynPRGVcJutfHULGYfYxJWkXdQovk7H-l7uo";

    const { bearer_token, max_pages, page, unique_id, driver_status, detail = 'true' } = req.query;
    const finalToken = bearer_token || HARDCODED_TOKEN;

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    const sendEvent = (eventName, data) => {
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const DEFAULT_UNIQUE_ID = unique_id || '03421121304617f701ba3b374.23310242';
    const DEFAULT_DRIVER_STATUS = driver_status || '2';
    const REPORT_URL = 'https://app.jagel.id/api/driver/report';

    async function fetchDriverDetail(view_uid) {
        const detailUrl = `https://app.jagel.id/api/users/${view_uid}?driver=1`;
        try {
            const response = await callJagelAppApi(detailUrl, finalToken, 'GET');
            return response.data;
        } catch (err) {
            console.warn(`⚠️ Failed to fetch detail for ${view_uid}: ${err.message}`);
            return null;
        }
    }

    async function fetchDriversReport(pageNum = 1) {
        const payload = {
            unique_id: DEFAULT_UNIQUE_ID,
            paginate: 10,
            driver_status: parseInt(DEFAULT_DRIVER_STATUS),
            page: pageNum
        };
        try {
            const response = await callJagelAppApi(REPORT_URL, finalToken, 'POST', payload);
            return response.data;
        } catch (err) {
            console.error(`❌ Failed to fetch report page ${pageNum}:`, err.message);
            return null;
        }
    }

    sendEvent('start', { message: 'Memulai pengambilan data driver' });

    if (page) {
        const reportData = await fetchDriversReport(parseInt(page));
        if (!reportData || !reportData.success) {
            sendEvent('error', { message: 'Gagal mengambil data report' });
            sendEvent('end', { message: 'Proses gagal' });
            return res.end();
        }

        const driversList = reportData.data?.drivers?.data || [];

        if (driversList.length > 0 && detail === 'true') {
            for (let i = 0; i < driversList.length; i++) {
                const driver = driversList[i];
                const detailData = await fetchDriverDetail(driver.view_uid);
                sendEvent('driver_update', { driver: { ...driver, detail: detailData } });
                await new Promise(r => setTimeout(r, 100));
            }
        } else if (driversList.length > 0) {
            sendEvent('batch', { drivers: driversList });
        }

        sendEvent('end', { success: true, total_drivers: driversList.length });
        return res.end();
    }

    const limit = Math.min(parseInt(max_pages) || 100, 200);
    let currentPage = 1;
    let lastPage = null;
    let processedDrivers = 0;

    while (currentPage <= limit) {
        const reportData = await fetchDriversReport(currentPage);
        if (!reportData || !reportData.success) break;

        const driversData = reportData.data?.drivers;
        if (!driversData) break;

        const driversList = driversData.data || [];

        if (lastPage === null) {
            lastPage = driversData.last_page || 0;
            sendEvent('meta', { total_pages: lastPage, total_drivers: driversData.total || 0 });
        }

        if (driversList.length === 0) break;

        if (detail === 'true') {
            for (let i = 0; i < driversList.length; i++) {
                const driver = driversList[i];
                const detailData = await fetchDriverDetail(driver.view_uid);
                processedDrivers++;
                sendEvent('driver_update', { count: processedDrivers, driver: { ...driver, detail: detailData } });
                await new Promise(r => setTimeout(r, 100));
            }
        } else {
            processedDrivers += driversList.length;
            sendEvent('batch', { page: currentPage, drivers: driversList });
        }

        if (currentPage >= lastPage) break;
        currentPage++;
        await new Promise(r => setTimeout(r, 150));
    }

    sendEvent('complete', { total_drivers: processedDrivers, total_pages: lastPage });
    sendEvent('end', { success: true });
    res.end();
});

// ============================================================
// ENDPOINT: POST /orders
// ============================================================
app.post('/orders', async (req, res) => {
    console.log('\n🛒 [ORDERS-CREATE] Request:', JSON.stringify(req.body, null, 2));

    if (!dbReady) return res.status(503).json({ error: 'Database not ready' });

    try {
        const body = req.body;
        if (!body.customer_name || !body.customer_phone) {
            return res.status(400).json({ success: false, error: 'customer_name dan customer_phone wajib diisi' });
        }

        const order_id = body.order_id || `ORD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const now = mysqlNow();
        const parsedTotal = parsePrice(body.total_price || 0);

        let orderStatus = body.order_status || 'PENDING';
        if (body.payment_status === 'PAID' && orderStatus === 'PENDING') {
            orderStatus = 'SEARCHING';
        }

        await pool.execute(`
            INSERT INTO orders (
                order_id, order_status, order_date, order_note,
                service_type, service_name, service_description,
                origin_address, origin_lat, origin_lng,
                destination_address, destination_lat, destination_lng,
                distance_km, estimated_duration_min,
                base_price, service_fee, discount, total_price,
                payment_method, payment_status, partner_reff,
                mitra_id, mitra_name, mitra_phone,
                driver_id, driver_name, driver_phone, driver_photo, driver_address, driver_lat, driver_lng,
                customer_name, customer_phone,
                created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
            order_id, orderStatus, body.order_date || now, body.order_note || null,
            body.service_type || null, body.service_name || null, body.service_description || null,
            body.origin_address || null, body.origin_lat || null, body.origin_lng || null,
            body.destination_address || null, body.destination_lat || null, body.destination_lng || null,
            body.distance_km || null, body.estimated_duration_min || null,
            body.base_price || 0, body.service_fee || 0, body.discount || 0, parsedTotal,
            body.payment_method || null, body.payment_status || 'UNPAID', body.partner_reff || null,
            body.mitra_id || null, body.mitra_name || null, body.mitra_phone || null,
            body.driver_id || null, body.driver_name || null, body.driver_phone || null,
            body.driver_photo || null, body.driver_address || null, body.driver_lat || null, body.driver_lng || null,
            body.customer_name, body.customer_phone, now, now
        ]);

        res.status(201).json({ success: true, message: 'Order berhasil dibuat', order_id, order_status: orderStatus });
    } catch (err) {
        console.error('❌ [ORDERS-CREATE] Error:', err.message);
        res.status(500).json({ error: 'Gagal membuat order', detail: err.message });
    }
});

app.get('/orders', async (req, res) => {
    try {
        const { driver_id, mitra_id, status, limit = 50, offset = 0 } = req.query;
        const conditions = [];
        const values = [];

        if (driver_id && driver_id !== 'undefined' && driver_id !== 'null') {
            conditions.push('driver_id = ?');
            values.push(driver_id);
        }
        if (mitra_id && mitra_id !== 'undefined' && mitra_id !== 'null') {
            conditions.push('mitra_id = ?');
            values.push(mitra_id);
        }
        if (status && status !== 'undefined' && status !== 'null' && status !== 'ALL') {
            conditions.push('order_status = ?');
            values.push(status.toUpperCase());
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const parsedLimit = Math.min(parseInt(limit) || 50, 1000);
        const parsedOffset = Math.max(parseInt(offset) || 0, 0);

        const query = `SELECT * FROM orders ${whereClause} ORDER BY created_at DESC LIMIT ${parsedLimit} OFFSET ${parsedOffset}`;
        const [results] = await pool.execute(query, values);

        res.json({ success: true, count: results.length, data: results });
    } catch (err) {
        console.error('❌ [ORDERS-LIST] Error:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data orders', detail: err.message });
    }
});

app.get('/orders/:order_id', async (req, res) => {
    const { order_id } = req.params;
    try {
        const [rows] = await pool.execute('SELECT * FROM orders WHERE order_id = ?', [order_id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('❌ [ORDERS-DETAIL] Error:', err.message);
        res.status(500).json({ error: 'Gagal mengambil detail order', detail: err.message });
    }
});

app.put('/orders/:order_id', async (req, res) => {
    const { order_id } = req.params;
    const body = req.body;

    try {
        const allowedFields = [
            'order_status', 'order_note', 'origin_address', 'origin_lat', 'origin_lng',
            'destination_address', 'destination_lat', 'destination_lng', 'distance_km',
            'estimated_duration_min', 'base_price', 'service_fee', 'discount', 'total_price',
            'payment_method', 'payment_status', 'partner_reff', 'mitra_id', 'mitra_name', 'mitra_phone',
            'driver_id', 'driver_name', 'driver_phone', 'driver_photo', 'driver_address', 'driver_lat', 'driver_lng',
            'customer_name', 'customer_phone'
        ];

        const setClauses = [];
        const values = [];
        for (const field of allowedFields) {
            if (body[field] !== undefined) {
                setClauses.push(`${field} = ?`);
                values.push(body[field]);
            }
        }

        if (!setClauses.length) {
            return res.status(400).json({ success: false, message: 'Tidak ada field valid untuk diupdate' });
        }

        setClauses.push('updated_at = ?');
        values.push(mysqlNow(), order_id);

        const [result] = await pool.execute(`UPDATE orders SET ${setClauses.join(', ')} WHERE order_id = ?`, values);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }

        if (body.driver_id && body.driver_name) {
            await pool.execute(`UPDATE orders SET order_status = 'CONFIRMED', updated_at = ? WHERE order_id = ?`, [mysqlNow(), order_id]);
        }

        res.json({ success: true, message: 'Order berhasil diupdate', order_id });
    } catch (err) {
        console.error('❌ [ORDERS-UPDATE] Error:', err.message);
        res.status(500).json({ error: 'Gagal mengupdate order', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /driver-confirmation
// ============================================================
app.post('/driver-confirmation', async (req, res) => {
    console.log('\n📋 [DRIVER-CONFIRMATION] Request:', JSON.stringify(req.body, null, 2));

    const { order_id, driver_id, driver_name, driver_phone, customer_name, customer_phone, total_amount, jumlah_toko } = req.body;

    if (!order_id) {
        return res.status(400).json({ success: false, message: 'order_id wajib diisi' });
    }

    const normalizedDriverPhone = driver_phone ? normalizePhoneNumber(driver_phone) : null;
    const normalizedCustomerPhone = customer_phone ? normalizePhoneNumber(customer_phone) : null;
    const parsedTotal = parsePrice(total_amount || 0);

    try {
        const [existingOrder] = await pool.execute('SELECT id FROM orders WHERE order_id = ?', [order_id]);

        if (existingOrder.length === 0) {
            // JANGAN BUAT ORDER BARU! Order harus sudah dibuat via POST /orders
            console.error(`❌ Order ${order_id} tidak ditemukan! Order harus dibuat terlebih dahulu via POST /orders`);
            return res.status(404).json({
                success: false,
                message: 'Order tidak ditemukan. Silakan buat order terlebih dahulu.',
                order_id: order_id
            });
        }

        await pool.execute(`
            UPDATE orders SET driver_id = ?, driver_name = ?, driver_phone = ?, updated_at = NOW() WHERE order_id = ?
        `, [driver_id || null, driver_name || null, normalizedDriverPhone, order_id]);
        console.log(`✅ Driver assigned to ${order_id}`);

        driverConfirmations.set(order_id, {
            driver_id, driver_name, driver_phone: normalizedDriverPhone,
            customer_name, customer_phone: normalizedCustomerPhone,
            total_amount: parsedTotal, jumlah_toko: jumlah_toko || 1,
            status: 'pending', timestamp: Date.now(), expiresAt: Date.now() + (3 * 60 * 1000)
        });

        let whatsappSent = false;
        if (driver_phone) {
            const result = await sendWhatsAppTemplate(driver_phone, CONFIG.templateDriverConfirmation, {
                "1": driver_name || 'Driver',
                "2": customer_name || 'Customer',
                "3": formatRupiah(parsedTotal),
                "4": String(jumlah_toko || 1)
            });
            whatsappSent = result.success;
        }

        res.json({ success: true, order_id, whatsapp_sent: whatsappSent });
    } catch (err) {
        console.error('❌ Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /send-whatsapp
// ============================================================
app.post('/send-whatsapp', async (req, res) => {
    console.log('\n📋 [SEND-WHATSAPP] Request:', JSON.stringify(req.body, null, 2));
    const { to, message, use_template, template_sid, variables } = req.body;

    let result;
    if (use_template && template_sid) {
        result = await sendWhatsAppTemplate(to, template_sid, variables || {});
    } else {
        result = await sendWhatsAppFreeForm(to, message);
    }

    res.json(result);
});

// ============================================================
// WEBHOOK WHATSAPP
// ============================================================
app.post('/webhook/whatsapp', express.urlencoded({ extended: true }), async (req, res) => {
    console.log('\n📨 [WEBHOOK] Received:', JSON.stringify(req.body, null, 2));

    const messageBody = req.body.Body || req.body.body;
    const fromNumber = req.body.From || req.body.from;
    const buttonPayload = req.body.ButtonPayload;

    if (!messageBody && !buttonPayload) return res.sendStatus(400);

    const rawDriverPhone = fromNumber.replace('whatsapp:', '');
    const driverPhone = normalizePhoneNumber(rawDriverPhone);
    const message = (buttonPayload || messageBody || '').trim().toUpperCase();

    console.log(`📱 Driver: ${driverPhone}, Message: ${message}`);

    let foundOrderId = null;
    let foundConfirmation = null;

    for (const [orderId, confirmation] of driverConfirmations) {
        if (confirmation.driver_phone === driverPhone && confirmation.status === 'pending') {
            foundOrderId = orderId;
            foundConfirmation = confirmation;
            break;
        }
    }

    if (foundOrderId && foundConfirmation && (message === 'ACCEPT' || message === 'TERIMA' || message === 'YES')) {
        foundConfirmation.status = 'accepted';
        driverConfirmations.set(foundOrderId, foundConfirmation);

        await pool.execute(`UPDATE orders SET order_status = 'CONFIRMED', updated_at = NOW() WHERE order_id = ?`, [foundOrderId]);
        console.log(`✅ Order ${foundOrderId} confirmed`);

        await sendWhatsAppFreeForm(rawDriverPhone, '✅ Terima kasih! Pesanan telah dikonfirmasi.');

        // Panggil fungsi yang sudah dibuat
        // await sendOrderDetailsToDriver(foundOrderId, foundConfirmation);
        // await notifyCustomerOrderAccepted(foundOrderId, foundConfirmation);
    } else if (foundOrderId && foundConfirmation && (message === 'REJECT' || message === 'TOLAK' || message === 'NO')) {
        foundConfirmation.status = 'rejected';
        driverConfirmations.set(foundOrderId, foundConfirmation);
        await pool.execute(`UPDATE orders SET order_status = 'CANCELLED', updated_at = NOW() WHERE order_id = ?`, [foundOrderId]);
        await sendWhatsAppFreeForm(rawDriverPhone, '❌ Pesanan ditolak.');
    }

    res.sendStatus(200);
});

// ============================================================
// FUNGSI KIRIM DETAIL ORDER KE DRIVER (TANPA AUTO-CREATE)
// ============================================================
async function sendOrderDetailsToDriver(orderId, confirmation) {
    console.log(`📦 [SEND-ORDER-DETAILS] Order: ${orderId}`);

    try {
        const [orders] = await pool.execute(
            'SELECT * FROM orders WHERE order_id = ?',
            [orderId]
        );

        // ❌ JANGAN BUAT ORDER BARU!
        if (orders.length === 0) {
            console.error(`❌ Order ${orderId} not found in database! Order harus dibuat terlebih dahulu via POST /orders`);
            console.log(`   Driver: ${confirmation.driver_name}, Customer: ${confirmation.customer_name}`);
            return;
        }

        const order = orders[0];

        await sendWhatsAppTemplate(confirmation.driver_phone, CONFIG.templateDriverOrderAccepted, {
            "1": confirmation.driver_name,
            "2": order.customer_name,
            "3": order.customer_phone,
            "4": orderId,
            "5": "Detail pesanan: " + (order.order_note || '-'),
            "6": formatRupiah(order.total_price)
        });

        console.log(`✅ Order details sent to driver`);

    } catch (error) {
        console.error(`❌ Error sending order details:`, error.message);
    }
}

// ============================================================
// FUNGSI NOTIFIKASI KE CUSTOMER (TANPA AUTO-CREATE)
// ============================================================
async function notifyCustomerOrderAccepted(orderId, confirmation) {
    console.log(`📧 [NOTIFY-CUSTOMER] Order: ${orderId}`);

    try {
        const [orders] = await pool.execute(
            'SELECT * FROM orders WHERE order_id = ?',
            [orderId]
        );

        if (orders.length === 0) {
            console.error(`❌ Order ${orderId} not found in database! Cannot notify customer.`);
            return;
        }

        const order = orders[0];

        await sendWhatsAppTemplate(order.customer_phone, CONFIG.templateCustomerOrderConfirmed, {
            "1": order.customer_name,
            "2": confirmation.driver_name,
            "3": confirmation.driver_phone,
            "4": orderId,
            "5": "Pesanan Anda sedang diproses oleh driver",
            "6": formatRupiah(order.total_price)
        });

        console.log(`✅ Customer notification sent to ${order.customer_phone}`);

    } catch (error) {
        console.error(`❌ Error sending customer notification:`, error.message);
    }
}

// ============================================================
// ENDPOINT: GET /check-confirmation/:orderId
// ============================================================
app.get('/check-confirmation/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const confirmation = driverConfirmations.get(orderId);

    if (confirmation) {
        if (confirmation.status === 'pending' && Date.now() > confirmation.expiresAt) {
            confirmation.status = 'timeout';
            driverConfirmations.set(orderId, confirmation);
        }
        res.json({ status: confirmation.status, driver_name: confirmation.driver_name, driver_phone: confirmation.driver_phone });
    } else {
        const [rows] = await pool.execute('SELECT order_status, driver_name, driver_phone FROM orders WHERE order_id = ?', [orderId]);
        if (rows.length > 0 && rows[0].order_status === 'CONFIRMED') {
            res.json({ status: 'accepted', driver_name: rows[0].driver_name, driver_phone: rows[0].driver_phone });
        } else {
            res.json({ status: 'not_found' });
        }
    }
});

// ============================================================
// ENDPOINT: GET /health
// ============================================================
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        database_ready: dbReady,
        twilio_ready: !!twilioClient,
        uptime: process.uptime()
    });
});

// ============================================================
// DEBUG ENDPOINTS
// ============================================================
app.get('/debug/driver-confirmations', async (req, res) => {
    const confirmations = [];
    for (const [orderId, conf] of driverConfirmations) {
        confirmations.push({
            order_id: orderId, status: conf.status, driver_name: conf.driver_name,
            driver_phone: conf.driver_phone, customer_name: conf.customer_name,
            customer_phone: conf.customer_phone, total_amount: conf.total_amount
        });
    }
    res.json({ total_pending: driverConfirmations.size, confirmations });
});

app.post('/fix-all-missing-orders', async (req, res) => {
    console.log('🔧 Fixing all missing orders from driver confirmations...');
    const fixedOrders = [], errors = [];

    for (const [orderId, confirmation] of driverConfirmations) {
        if (confirmation.status === 'accepted') {
            try {
                const [existing] = await pool.execute('SELECT order_id FROM orders WHERE order_id = ?', [orderId]);
                if (existing.length === 0) {
                    const now = mysqlNow();
                    let parsedTotal = confirmation.total_amount || 21000;
                    if (typeof parsedTotal === 'string') {
                        parsedTotal = parseInt(parsedTotal.replace(/\D/g, '')) || 21000;
                    }

                    await pool.execute(`
                        INSERT INTO orders (order_id, order_status, order_date, customer_name, customer_phone,
                            total_price, payment_status, driver_id, driver_name, driver_phone, created_at, updated_at)
                        VALUES (?, 'CONFIRMED', ?, ?, ?, ?, 'PAID', ?, ?, ?, NOW(), NOW())
                        ON DUPLICATE KEY UPDATE 
                            driver_id = VALUES(driver_id), driver_name = VALUES(driver_name),
                            driver_phone = VALUES(driver_phone), order_status = 'CONFIRMED', updated_at = NOW()
                    `, [orderId, now, confirmation.customer_name, confirmation.customer_phone || '6282323907426',
                        parsedTotal, confirmation.driver_id, confirmation.driver_name, confirmation.driver_phone]);
                    fixedOrders.push(orderId);
                }
            } catch (error) {
                errors.push({ orderId, error: error.message });
            }
        }
    }
    res.json({ success: true, fixed_count: fixedOrders.length, fixed_orders: fixedOrders, errors });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = CONFIG.port;
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`========================================`);
    console.log(`\n✅ Endpoints ready:`);
    console.log(`   POST /create-va`);
    console.log(`   POST /create-qris`);
    console.log(`   GET  /check-status/:partner_reff`);
    console.log(`   POST /callback`);
    console.log(`   GET  /drivers`);
    console.log(`   POST /orders`);
    console.log(`   GET  /orders`);
    console.log(`   GET  /orders/:order_id`);
    console.log(`   PUT  /orders/:order_id`);
    console.log(`   POST /driver-confirmation`);
    console.log(`   POST /send-whatsapp`);
    console.log(`   POST /webhook/whatsapp`);
    console.log(`   GET  /check-confirmation/:orderId`);
    console.log(`   GET  /health`);
    console.log(`   GET  /debug/driver-confirmations`);
    console.log(`   POST /fix-all-missing-orders`);
    console.log(`\n📱 Driver confirmation flow is READY!\n`);
});