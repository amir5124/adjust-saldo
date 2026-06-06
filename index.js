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

// ============================================================
// KONFIGURASI - DARI ENVIRONMENT VARIABLES
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
    MUDICOUrl: process.env.MUDICO_URL || 'https://mudico.my.id/mudico.php',
    jagelApiKey: process.env.JAGEL_APIKEY || 'q2t7lktZkZIEiCDs7y9HpWP0WCRdABEGTrHidEUhrAMe0IDzXV',
    linkquGateway: process.env.LINKQU_GATEWAY || 'https://gateway-dev.linkqu.id/linkqu-partner',
    jagelBaseUrl: process.env.JAGEL_BASE_URL || 'https://api.jagel.id/v1',
    port: parseInt(process.env.PORT || '3000'),

    // Twilio Configuration
    twilioSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuth: process.env.TWILIO_AUTH_TOKEN || '',
    twilioWaNumber: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
    adminWaNumber: process.env.ADMIN_WHATSAPP_NUMBER || 'whatsapp:+6282323907426',
    csNumber: process.env.CS_PHONE_NUMBER || '6282226666610',
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',

    // Twilio Content Template SIDs (Approved)
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
    console.log(`   TWILIO_ACCOUNT_SID: ${CONFIG.twilioSid ? '✅ SET (' + CONFIG.twilioSid.substring(0, 10) + '...)' : '❌ MISSING'}`);
    console.log(`   TWILIO_AUTH_TOKEN: ${CONFIG.twilioAuth ? '✅ SET (' + CONFIG.twilioAuth.substring(0, 10) + '...)' : '❌ MISSING'}`);
    console.log(`   TWILIO_WHATSAPP_NUMBER: ${CONFIG.twilioWaNumber}`);

    if (!CONFIG.twilioSid || !CONFIG.twilioAuth) {
        console.error('\n❌❌❌ TWILIO CREDENTIALS MISSING! ❌❌❌');
        console.error('Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env file');
        console.error('WhatsApp messages will NOT be sent!\n');
        return null;
    }

    try {
        twilioClient = twilio(CONFIG.twilioSid, CONFIG.twilioAuth);
        console.log('✅ Twilio client initialized successfully!');
        console.log(`   WhatsApp Business Number: ${CONFIG.twilioWaNumber}`);
        console.log(`   Templates ready: ${Object.keys(CONFIG).filter(k => k.startsWith('template')).length} templates\n`);
        return twilioClient;
    } catch (error) {
        console.error('❌ Failed to initialize Twilio client:', error.message);
        return null;
    }
}

// Panggil initTwilio di awal
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
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
});

// ============================================================
// GLOBAL VARIABLES & LOGGER
// ============================================================
const driverConfirmations = new Map();
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function logToFile(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const logPath = path.join(LOG_DIR, `${type.toLowerCase()}.log`);
    const logMessage = `[${timestamp}] [${type}] ${message}\n`;
    fs.appendFile(logPath, logMessage, (err) => {
        if (err) console.error('Gagal write log:', err.message);
    });
    console.log(logMessage.trim());
}

function parsePrice(price) {
    if (price === null || price === undefined) return 0;
    if (typeof price === 'number') return price;

    let priceStr = String(price);
    priceStr = priceStr.replace(/[Rr][Pp]\s*/g, '');
    priceStr = priceStr.replace(/[$,]/g, '');
    priceStr = priceStr.replace(/\./g, '');
    priceStr = priceStr.replace(/,/g, '.');

    const parsed = parseFloat(priceStr);
    return isNaN(parsed) ? 0 : parsed;
}

// ============================================================
// TEST DATABASE CONNECTION
// ============================================================
async function testDatabaseConnection() {
    console.log('\n🔍 Testing database connection...');
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.query('SELECT VERSION() as version, NOW() as now, DATABASE() as db, USER() as user');
        console.log('✅ DATABASE CONNECTED!');
        console.log(`   MySQL Version: ${rows[0].version}`);
        console.log(`   Server Time:   ${rows[0].now}`);
        console.log(`   Database:      ${rows[0].db}`);
        console.log(`   User:          ${rows[0].user}`);
        connection.release();
        return true;
    } catch (err) {
        console.error('❌ DATABASE CONNECTION FAILED!');
        console.error(`   Error: ${err.message}`);
        return false;
    }
}

let dbReady = false;
testDatabaseConnection().then(result => { dbReady = result; });

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function generateCustomerId() {
    const timestamp = Date.now().toString().slice(-5);
    const random = Math.floor(Math.random() * 90000 + 10000).toString();
    return timestamp + random;
}

function getExpiredTimestamp(minutes = 15) {
    return moment.tz('Asia/Jakarta').add(minutes, 'minutes').format('YYYYMMDDHHmmss');
}

function generatePartnerReff() {
    const ts = Date.now();
    const rnd = crypto.randomBytes(4).toString('hex');
    return `INV-782372373627-${ts}-${rnd}`;
}

function mysqlNow() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
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
    let cleaned = phoneNumber.toString().replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '62' + cleaned.substring(1);
    if (!cleaned.startsWith('62')) cleaned = '62' + cleaned;
    return `whatsapp:${cleaned}`;
}

function formatRupiah(amount) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
}

async function callJagelAppApi(url, bearerToken, method = 'GET', data = null) {
    const config = {
        method, url,
        headers: { 'Authorization': `Bearer ${bearerToken}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
        timeout: 30000,
        httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
    };
    if (method === 'POST' && data) config.data = data;
    console.log(`🌐 [JAGEL-APP-API] ${method} ${url}`);
    const response = await axios(config);
    console.log(`✅ [JAGEL-APP-API] Status: ${response.status}`);
    return response;
}

async function callJagelApi(url, data = null, method = 'POST') {
    try {
        const config = {
            method, url,
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            timeout: 30000,
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
        };
        if (method === 'POST' && data) config.data = data;
        console.log(`🌐 [JAGEL-API] ${method} ${url}`);
        const response = await axios(config);
        console.log(`✅ [JAGEL-API] Status: ${response.status}`);
        return response;
    } catch (error) {
        if (error.response) {
            console.error(`❌ [JAGEL-API] HTTP ${error.response.status}:`, error.response.data);
            return { data: { success: false, message: `API Error: ${error.response.status}` } };
        }
        console.error(`❌ [JAGEL-API] Error:`, error.message);
        return { data: { success: false, message: `Error: ${error.message}` } };
    }
}

async function addBalance(amount, customer_name, methodCode, serialnumber) {
    const originalAmount = parseInt(amount);
    let admin = methodCode === 'QRIS' ? Math.round(originalAmount * 0.008) : 4000;
    const netAmount = originalAmount - admin;
    const username = 'amir';
    const note = `Pesanan dari ${customer_name} || Rp ${netAmount.toLocaleString('id-ID')} (admin ${admin.toLocaleString('id-ID')}) || ${methodCode === 'QRIS' ? 'QRIS' : 'VA'} || Reff: ${serialnumber}`;
    console.log(`💰 [ADD-BALANCE] ${customer_name} -> ${username} | Amount: ${netAmount} | Admin: ${admin}`);
    try {
        const response = await axios.post(`${CONFIG.jagelBaseUrl}/balance/adjust`, {
            action: 'adjust_balance', type: 'username', value: username, amount: netAmount, note: note, apikey: CONFIG.jagelApiKey
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
        console.log('✅ Balance added:', response.data);
        return { success: true, data: response.data };
    } catch (error) {
        console.error('❌ Add balance failed:', error.message);
        throw error;
    }
}

async function sendWhatsAppTemplate(to, templateSid, variables) {
    console.log(`\n📤 [SEND-TEMPLATE] To: ${to}, Template: ${templateSid}`);
    if (!twilioClient) {
        initTwilio();
        if (!twilioClient) return { success: false, error: 'Twilio client not initialized' };
    }
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
        console.log(`✅ Template sent successfully! SID: ${result.sid}`);
        return { success: true, sid: result.sid, status: result.status };
    } catch (error) {
        console.error('❌ Twilio template error:', error.message);
        return { success: false, error: error.message, code: error.code };
    }
}

async function sendWhatsAppFreeForm(to, message) {
    console.log(`\n📤 [SEND-FREE-FORM] To: ${to}`);
    if (!twilioClient) return { success: false, error: 'Twilio client not initialized' };
    const whatsappTo = formatWhatsAppNumber(to);
    if (!whatsappTo) return { success: false, error: 'Invalid phone number' };
    try {
        const result = await twilioClient.messages.create({
            from: CONFIG.twilioWaNumber,
            to: whatsappTo,
            body: message
        });
        console.log(`✅ Free-form sent, SID: ${result.sid}`);
        return { success: true, sid: result.sid };
    } catch (error) {
        console.error('❌ Free-form error:', error.message);
        return { success: false, error: error.message };
    }
}

// ============================================================
// ENDPOINT: POST /orders (BUAT ORDER BARU - HANYA UNTUK PEMBUATAN AWAL)
// ============================================================
const VALID_ORDER_STATUSES = ['PENDING', 'SEARCHING', 'CONFIRMED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'FAILED'];
const VALID_PAYMENT_STATUSES = ['UNPAID', 'PAID', 'REFUNDED', 'FAILED'];

app.post('/orders', async (req, res) => {
    console.log('\n🛒 [ORDERS-CREATE] Request received:', JSON.stringify(req.body, null, 2));
    try {
        const body = req.body;
        if (!body.customer_name || !body.customer_phone) {
            return res.status(400).json({ success: false, error: 'customer_name dan customer_phone wajib diisi' });
        }
        const order_id = `ORD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const now = mysqlNow();
        const fields = {
            order_id, order_status: (body.order_status || 'PENDING').toUpperCase(), order_date: body.order_date || now,
            order_note: body.order_note || null, service_type: body.service_type || null, service_name: body.service_name || null,
            service_description: body.service_description || null, origin_address: body.origin_address || null,
            origin_lat: body.origin_lat ?? null, origin_lng: body.origin_lng ?? null,
            destination_address: body.destination_address || null, destination_lat: body.destination_lat ?? null,
            destination_lng: body.destination_lng ?? null, distance_km: body.distance_km ?? null,
            estimated_duration_min: body.estimated_duration_min ?? null, base_price: body.base_price ?? 0,
            service_fee: body.service_fee ?? 0, discount: body.discount ?? 0, total_price: body.total_price ?? 0,
            payment_method: body.payment_method || null, payment_status: (body.payment_status || 'UNPAID').toUpperCase(),
            partner_reff: body.partner_reff || null, mitra_id: body.mitra_id || null, mitra_name: body.mitra_name || null,
            mitra_phone: body.mitra_phone || null, driver_id: body.driver_id || null, driver_name: body.driver_name || null,
            driver_phone: body.driver_phone || null, driver_photo: body.driver_photo || null,
            driver_address: body.driver_address || null, driver_lat: body.driver_lat ?? null, driver_lng: body.driver_lng ?? null,
            customer_name: body.customer_name, customer_phone: body.customer_phone, created_at: now, updated_at: now,
        };
        const [dbResult] = await pool.execute(`INSERT INTO orders (${Object.keys(fields).join(', ')}) VALUES (${Object.keys(fields).map(() => '?').join(', ')})`, Object.values(fields));
        console.log(`✅ [ORDERS-CREATE] Order created: ${order_id}`);
        res.status(201).json({ success: true, message: 'Order berhasil dibuat', order_id, insert_id: dbResult.insertId });
    } catch (err) {
        console.error('❌ [ORDERS-CREATE] Error:', err.message);
        res.status(500).json({ error: 'Gagal membuat order', detail: err.message });
    }
});

app.get('/orders', async (req, res) => {
    const { driver_id, mitra_id, status, limit = 50, offset = 0 } = req.query;
    try {
        const limitVal = Math.min(Math.max(1, parseInt(limit) || 50), 200);
        const offsetVal = Math.max(0, parseInt(offset) || 0);
        const where = [], params = [];
        if (driver_id) { where.push('driver_id = ?'); params.push(driver_id); }
        if (mitra_id) { where.push('mitra_id = ?'); params.push(mitra_id); }
        if (status) { where.push('order_status = ?'); params.push(status.toUpperCase()); }
        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const [results] = await pool.query(`SELECT * FROM orders ${whereClause} ORDER BY created_at DESC LIMIT ${limitVal} OFFSET ${offsetVal}`, params);
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
        const allowedFields = ['order_status', 'order_note', 'origin_address', 'origin_lat', 'origin_lng', 'destination_address', 'destination_lat', 'destination_lng', 'distance_km', 'estimated_duration_min', 'base_price', 'service_fee', 'discount', 'total_price', 'payment_method', 'payment_status', 'partner_reff', 'mitra_id', 'mitra_name', 'mitra_phone', 'driver_id', 'driver_name', 'driver_phone', 'driver_photo', 'driver_address', 'driver_lat', 'driver_lng', 'customer_name', 'customer_phone'];
        const setClauses = [], values = [];
        for (const field of allowedFields) {
            if (body[field] !== undefined) {
                setClauses.push(`${field} = ?`);
                values.push((field === 'order_status' || field === 'payment_status') ? body[field].toUpperCase() : body[field]);
            }
        }
        if (!setClauses.length) return res.status(400).json({ success: false, message: 'Tidak ada field valid untuk diupdate' });
        setClauses.push('updated_at = ?');
        values.push(mysqlNow(), order_id);
        const [result] = await pool.execute(`UPDATE orders SET ${setClauses.join(', ')} WHERE order_id = ?`, values);
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        console.log(`✅ [ORDERS-UPDATE] Order updated: ${order_id}`);
        res.json({ success: true, message: 'Order berhasil diupdate', order_id });
    } catch (err) {
        console.error('❌ [ORDERS-UPDATE] Error:', err.message);
        res.status(500).json({ error: 'Gagal mengupdate order', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /driver-confirmation (TIDAK MEMBUAT ORDER BARU, HANYA UPDATE)
// ============================================================
app.post('/driver-confirmation', async (req, res) => {
    console.log('\n📋 [DRIVER-CONFIRMATION] Request:', JSON.stringify(req.body, null, 2));
    const { order_id, driver_id, driver_name, driver_phone, customer_name, customer_phone, total_amount, total_price, jumlah_toko } = req.body;

    if (!order_id) {
        return res.status(400).json({ success: false, message: 'order_id wajib diisi' });
    }
    if (!customer_phone) {
        return res.status(400).json({ success: false, message: 'customer_phone wajib diisi' });
    }

    const normalizedDriverPhone = driver_phone ? normalizePhoneNumber(driver_phone) : null;
    const normalizedCustomerPhone = normalizePhoneNumber(customer_phone);
    const finalCustomerName = customer_name || 'Customer';
    const parsedTotal = parsePrice(total_price || total_amount || 0);

    console.log(`📋 Order: ${order_id}, Driver: ${driver_name}, Customer: ${finalCustomerName}`);

    try {
        // CEK APAKAH ORDER SUDAH ADA DI DATABASE
        const [existingOrder] = await pool.execute('SELECT order_status, driver_id FROM orders WHERE order_id = ?', [order_id]);

        if (existingOrder.length === 0) {
            // ORDER TIDAK DITEMUKAN - KEMBALIKAN ERROR
            console.error(`❌ Order ${order_id} not found in database! Order must be created first via POST /orders`);
            return res.status(404).json({
                success: false,
                message: 'Order tidak ditemukan. Silakan buat order terlebih dahulu.',
                order_id: order_id
            });
        }

        // ORDER DITEMUKAN - UPDATE DATA DRIVER (TIDAK MERUBAH STATUS)
        const currentStatus = existingOrder[0].order_status;
        await pool.execute(
            `UPDATE orders 
             SET driver_id = ?, driver_name = ?, driver_phone = ?, 
                 customer_name = ?, customer_phone = ?, total_price = ?,
                 updated_at = NOW()
             WHERE order_id = ?`,
            [driver_id || null, driver_name || null, normalizedDriverPhone, finalCustomerName, normalizedCustomerPhone, parsedTotal, order_id]
        );
        console.log(`✅ Order ${order_id} updated with driver data (status tetap: ${currentStatus})`);

        // Simpan ke memory cache untuk tracking konfirmasi
        driverConfirmations.set(order_id, {
            driver_id: driver_id || null,
            driver_name: driver_name || 'Driver',
            driver_phone: normalizedDriverPhone,
            customer_name: finalCustomerName,
            customer_phone: normalizedCustomerPhone,
            total_amount: parsedTotal,
            jumlah_toko: jumlah_toko || 1,
            status: 'pending',
            timestamp: Date.now(),
            expiresAt: Date.now() + (3 * 60 * 1000)
        });

        // Kirim WhatsApp ke driver
        let whatsappSent = false;
        if (driver_phone && normalizedDriverPhone) {
            try {
                const result = await sendWhatsAppTemplate(driver_phone, CONFIG.templateDriverConfirmation, {
                    "1": driver_name || 'Driver',
                    "2": finalCustomerName,
                    "3": formatRupiah(parsedTotal),
                    "4": String(jumlah_toko || 1)
                });
                whatsappSent = result.success;
            } catch (waError) {
                console.error(`📱 WhatsApp error:`, waError.message);
            }
        }

        res.json({ success: true, order_id, driver_confirmed: true, whatsapp_sent: whatsappSent, message: 'Driver data saved, menunggu konfirmasi driver' });
    } catch (err) {
        console.error('❌ Database error:', err.message);
        res.status(500).json({ success: false, message: 'Gagal memproses konfirmasi driver', error: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /driver-confirm (ENDPOINT UNTUK KONFIRMASI DRIVER - UPDATE STATUS)
// ============================================================
app.post('/driver-confirm', async (req, res) => {
    console.log('\n✅ [DRIVER-CONFIRM] Request:', JSON.stringify(req.body, null, 2));
    const { order_id, action, driver_id, driver_name, driver_phone } = req.body;

    if (!order_id) {
        return res.status(400).json({ success: false, message: 'order_id wajib diisi' });
    }
    if (!action || !['accept', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, message: 'action harus "accept" atau "reject"' });
    }

    try {
        const [existingOrder] = await pool.execute('SELECT order_status, customer_name, customer_phone, total_price FROM orders WHERE order_id = ?', [order_id]);
        if (existingOrder.length === 0) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }

        const order = existingOrder[0];
        const newStatus = action === 'accept' ? 'CONFIRMED' : 'CANCELLED';

        await pool.execute(`UPDATE orders SET order_status = ?, updated_at = NOW() WHERE order_id = ?`, [newStatus, order_id]);
        console.log(`✅ Order ${order_id} status updated to ${newStatus}`);

        if (action === 'accept') {
            // Kirim notifikasi ke customer
            await sendWhatsAppTemplate(order.customer_phone, CONFIG.templateCustomerOrderConfirmed, {
                "1": order.customer_name,
                "2": driver_name || 'Driver',
                "3": driver_phone || '',
                "4": order_id,
                "5": "Pesanan Anda sedang diproses oleh driver",
                "6": formatRupiah(order.total_price)
            });

            await sendWhatsAppFreeForm(driver_phone, '✅ Pesanan telah Anda terima. Terima kasih!');
        } else {
            await sendWhatsAppTemplate(order.customer_phone, CONFIG.templateDriverRejected, { "1": order.customer_name });
            await sendWhatsAppFreeForm(driver_phone, '❌ Pesanan ditolak. Terima kasih.');
        }

        res.json({ success: true, order_id, status: newStatus, message: `Order ${action}ed successfully` });
    } catch (err) {
        console.error('❌ Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// WEBHOOK WHATSAPP - MENERIMA KONFIRMASI DARI DRIVER
// ============================================================
app.post('/webhook/whatsapp', express.urlencoded({ extended: true }), async (req, res) => {
    console.log('\n📨 [WEBHOOK] Received');
    const messageBody = req.body.Body || req.body.body;
    const fromNumber = req.body.From || req.body.from;
    const buttonPayload = req.body.ButtonPayload;

    if (!messageBody && !buttonPayload) return res.sendStatus(400);

    const rawDriverPhone = fromNumber.replace('whatsapp:', '');
    const driverPhone = normalizePhoneNumber(rawDriverPhone);
    let message = (buttonPayload || messageBody || '').trim().toUpperCase();
    console.log(`📱 From: ${driverPhone}, Message: ${message}`);

    // Cari order pending di memory cache
    let foundOrderId = null;
    let foundConfirmation = null;
    for (const [orderId, confirmation] of driverConfirmations) {
        if (confirmation.driver_phone === driverPhone && confirmation.status === 'pending') {
            foundOrderId = orderId;
            foundConfirmation = confirmation;
            break;
        }
    }

    if (foundOrderId && foundConfirmation) {
        if (message === 'ACCEPT' || message === 'TERIMA' || message === 'YES') {
            // UPDATE STATUS ORDER MENJADI CONFIRMED
            try {
                await pool.execute(`UPDATE orders SET order_status = 'CONFIRMED', updated_at = NOW() WHERE order_id = ?`, [foundOrderId]);
                console.log(`✅ Order ${foundOrderId} status updated to CONFIRMED`);

                // Update memory cache
                foundConfirmation.status = 'accepted';
                driverConfirmations.set(foundOrderId, foundConfirmation);

                // Kirim notifikasi
                await sendWhatsAppFreeForm(rawDriverPhone, '✅ Terima kasih! Pesanan telah dikonfirmasi.');

                const [order] = await pool.execute('SELECT customer_name, customer_phone, total_price FROM orders WHERE order_id = ?', [foundOrderId]);
                if (order.length > 0) {
                    await sendWhatsAppTemplate(order[0].customer_phone, CONFIG.templateCustomerOrderConfirmed, {
                        "1": order[0].customer_name,
                        "2": foundConfirmation.driver_name,
                        "3": driverPhone,
                        "4": foundOrderId,
                        "5": "Pesanan Anda sedang diproses oleh driver",
                        "6": formatRupiah(order[0].total_price)
                    });
                }
            } catch (dbError) {
                console.error(`❌ Database error:`, dbError.message);
            }
        } else if (message === 'REJECT' || message === 'TOLAK' || message === 'NO') {
            try {
                await pool.execute(`UPDATE orders SET order_status = 'CANCELLED', updated_at = NOW() WHERE order_id = ?`, [foundOrderId]);
                console.log(`❌ Order ${foundOrderId} cancelled`);

                foundConfirmation.status = 'rejected';
                driverConfirmations.set(foundOrderId, foundConfirmation);
                await sendWhatsAppFreeForm(rawDriverPhone, '❌ Pesanan ditolak. Terima kasih.');
            } catch (dbError) {
                console.error(`❌ Database error:`, dbError.message);
            }
        }
    } else {
        console.log(`⚠️ No pending order found for driver ${driverPhone}`);
    }

    res.sendStatus(200);
});

// ============================================================
// ENDPOINT LAINNYA (YANG TIDAK BERUBAH)
// ============================================================
app.get('/check-confirmation/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const confirmation = driverConfirmations.get(orderId);
    if (confirmation) {
        if (confirmation.status === 'pending' && Date.now() > confirmation.expiresAt) {
            confirmation.status = 'timeout';
            driverConfirmations.set(orderId, confirmation);
        }
        res.json({ status: confirmation.status, driver_id: confirmation.driver_id, driver_name: confirmation.driver_name, driver_phone: confirmation.driver_phone });
    } else {
        // Cek dari database
        const [rows] = await pool.execute('SELECT order_status, driver_id, driver_name, driver_phone FROM orders WHERE order_id = ?', [orderId]);
        if (rows.length > 0 && rows[0].order_status === 'CONFIRMED') {
            res.json({ status: 'accepted', driver_id: rows[0].driver_id, driver_name: rows[0].driver_name, driver_phone: rows[0].driver_phone });
        } else {
            res.json({ status: 'not_found' });
        }
    }
});

app.get('/driver/accept/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const confirmation = driverConfirmations.get(orderId);
    if (confirmation && confirmation.status === 'pending' && Date.now() < confirmation.expiresAt) {
        await pool.execute(`UPDATE orders SET order_status = 'CONFIRMED', updated_at = NOW() WHERE order_id = ?`, [orderId]);
        confirmation.status = 'accepted';
        driverConfirmations.set(orderId, confirmation);
        res.send(`<html><body style="text-align:center;padding:50px;"><h1>✅ Pesanan Diterima!</h1><p>Order ID: ${orderId}</p><script>setTimeout(()=>window.close(),3000);</script></body></html>`);
    } else {
        res.send(`<html><body style="text-align:center;padding:50px;"><h1>⏰ Konfirmasi Kadaluwarsa</h1></body></html>`);
    }
});

app.get('/driver/reject/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const confirmation = driverConfirmations.get(orderId);
    if (confirmation && confirmation.status === 'pending' && Date.now() < confirmation.expiresAt) {
        await pool.execute(`UPDATE orders SET order_status = 'CANCELLED', updated_at = NOW() WHERE order_id = ?`, [orderId]);
        confirmation.status = 'rejected';
        driverConfirmations.set(orderId, confirmation);
        res.send(`<html><body style="text-align:center;padding:50px;"><h1>❌ Pesanan Ditolak</h1></body></html>`);
    } else {
        res.send(`<html><body style="text-align:center;padding:50px;"><h1>⏰ Konfirmasi Kadaluwarsa</h1></body></html>`);
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString(), database_ready: dbReady, twilio_ready: !!twilioClient });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = CONFIG.port;
app.listen(PORT, () => {
    console.log('\n========================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log('========================================\n');
});