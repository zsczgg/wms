import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 4173);
const ROOT = process.cwd();
const PUBLIC_DIR = join(ROOT, "public");
const DATA_DIR = join(ROOT, "data");
const DB_FILE = join(DATA_DIR, "db.json");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const seedDb = {
  users: [
    {
      id: "admin",
      role: "admin",
      name: "仓库管理员",
      company: "主仓运营",
      username: "admin",
      password: "admin123",
      status: "active",
      createdAt: new Date().toISOString()
    },
    {
      id: "client-aurora",
      role: "client",
      name: "林小姐",
      company: "星河选品",
      username: "client",
      password: "client123",
      status: "active",
      createdAt: new Date().toISOString()
    }
  ],
  inventory: [
    {
      id: "sku-001",
      ownerId: "client-aurora",
      sku: "AURORA-CASE-01",
      name: "磁吸手机壳 透明款",
      location: "A-03-02",
      quantity: 128,
      locked: 12,
      updatedAt: new Date().toISOString()
    },
    {
      id: "sku-002",
      ownerId: "client-aurora",
      sku: "AURORA-CABLE-C",
      name: "Type-C 编织快充线",
      location: "B-01-11",
      quantity: 260,
      locked: 0,
      updatedAt: new Date().toISOString()
    }
  ],
  requests: [
    {
      id: "req-demo-1",
      ownerId: "client-aurora",
      type: "inbound",
      status: "pending",
      title: "入库 80 件 磁吸手机壳",
      sku: "AURORA-CASE-01",
      productName: "磁吸手机壳 透明款",
      quantity: 80,
      trackingNo: "SF100020003000",
      receiver: "",
      address: "",
      note: "预计明天下午到仓",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  sessions: []
};

async function ensureDb() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await stat(DB_FILE);
  } catch {
    await writeFile(DB_FILE, JSON.stringify(seedDb, null, 2));
  }
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await readFile(DB_FILE, "utf-8"));
}

async function writeDb(db) {
  await writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return {};
  }
}

function publicUser(user) {
  const { password, ...rest } = user;
  return rest;
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => !String(body[field] || "").trim());
  if (missing.length) {
    const error = new Error(`缺少字段：${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
}

async function getSession(req, db) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const session = db.sessions.find((item) => item.token === token);
  if (!session) return null;
  const user = db.users.find((item) => item.id === session.userId && item.status === "active");
  return user ? { session, user } : null;
}

function assertRole(auth, role) {
  if (!auth) {
    const error = new Error("请先登录");
    error.status = 401;
    throw error;
  }
  if (role && auth.user.role !== role) {
    const error = new Error("没有权限");
    error.status = 403;
    throw error;
  }
}

function normalizeRequestType(type) {
  if (["inbound", "return", "dropship"].includes(type)) return type;
  return "inbound";
}

function typeLabel(type) {
  return { inbound: "入库", return: "退仓", dropship: "代发" }[type] || "申请";
}

function requestTitle(type, quantity, productName) {
  return `${typeLabel(type)} ${Number(quantity || 0)} 件 ${productName || "货品"}`;
}

function now() {
  return new Date().toISOString();
}

async function handleApi(req, res, url) {
  const db = await readDb();
  const auth = await getSession(req, db);
  const body = req.method === "GET" ? {} : await readBody(req);

  if (url.pathname === "/api/login" && req.method === "POST") {
    requireFields(body, ["username", "password"]);
    const user = db.users.find(
      (item) =>
        item.username === body.username &&
        item.password === body.password &&
        item.status === "active"
    );
    if (!user) return sendJson(res, 401, { error: "账号或密码不正确" });
    const token = randomUUID();
    db.sessions = db.sessions.filter((item) => item.userId !== user.id);
    db.sessions.push({ token, userId: user.id, createdAt: now() });
    await writeDb(db);
    return sendJson(res, 200, { token, user: publicUser(user) });
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    if (auth) {
      db.sessions = db.sessions.filter((item) => item.token !== auth.session.token);
      await writeDb(db);
    }
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === "/api/me" && req.method === "GET") {
    assertRole(auth);
    return sendJson(res, 200, { user: publicUser(auth.user) });
  }

  if (url.pathname === "/api/client/summary" && req.method === "GET") {
    assertRole(auth, "client");
    const inventory = db.inventory.filter((item) => item.ownerId === auth.user.id);
    const requests = db.requests
      .filter((item) => item.ownerId === auth.user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sendJson(res, 200, {
      inventory,
      requests,
      stats: {
        skuCount: inventory.length,
        totalQuantity: inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        locked: inventory.reduce((sum, item) => sum + Number(item.locked || 0), 0),
        pending: requests.filter((item) => item.status === "pending").length
      }
    });
  }

  if (url.pathname === "/api/client/requests" && req.method === "POST") {
    assertRole(auth, "client");
    requireFields(body, ["type", "sku", "productName", "quantity"]);
    const type = normalizeRequestType(body.type);
    const request = {
      id: randomUUID(),
      ownerId: auth.user.id,
      type,
      status: "pending",
      title: requestTitle(type, body.quantity, body.productName),
      sku: String(body.sku).trim(),
      productName: String(body.productName).trim(),
      quantity: Math.max(1, Number(body.quantity || 1)),
      trackingNo: String(body.trackingNo || "").trim(),
      receiver: String(body.receiver || "").trim(),
      address: String(body.address || "").trim(),
      note: String(body.note || "").trim(),
      createdAt: now(),
      updatedAt: now()
    };
    db.requests.push(request);
    await writeDb(db);
    return sendJson(res, 201, { request });
  }

  if (url.pathname === "/api/admin/summary" && req.method === "GET") {
    assertRole(auth, "admin");
    const clients = db.users.filter((item) => item.role === "client").map(publicUser);
    const requests = db.requests
      .map((item) => ({
        ...item,
        owner: publicUser(db.users.find((user) => user.id === item.ownerId) || {})
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sendJson(res, 200, {
      clients,
      inventory: db.inventory,
      requests,
      stats: {
        clients: clients.length,
        skuCount: db.inventory.length,
        totalQuantity: db.inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        pending: db.requests.filter((item) => item.status === "pending").length
      }
    });
  }

  if (url.pathname === "/api/admin/clients" && req.method === "POST") {
    assertRole(auth, "admin");
    requireFields(body, ["company", "name", "username", "password"]);
    if (db.users.some((item) => item.username === body.username)) {
      return sendJson(res, 409, { error: "登录账号已存在" });
    }
    const user = {
      id: randomUUID(),
      role: "client",
      company: String(body.company).trim(),
      name: String(body.name).trim(),
      username: String(body.username).trim(),
      password: String(body.password).trim(),
      status: "active",
      createdAt: now()
    };
    db.users.push(user);
    await writeDb(db);
    return sendJson(res, 201, { user: publicUser(user) });
  }

  if (url.pathname === "/api/admin/inventory" && req.method === "POST") {
    assertRole(auth, "admin");
    requireFields(body, ["ownerId", "sku", "name", "quantity"]);
    const quantity = Number(body.quantity || 0);
    const existing = db.inventory.find(
      (item) => item.ownerId === body.ownerId && item.sku === String(body.sku).trim()
    );
    if (existing) {
      existing.quantity = Math.max(0, Number(existing.quantity || 0) + quantity);
      existing.name = String(body.name).trim();
      existing.location = String(body.location || existing.location || "待上架").trim();
      existing.updatedAt = now();
    } else {
      db.inventory.push({
        id: randomUUID(),
        ownerId: String(body.ownerId).trim(),
        sku: String(body.sku).trim(),
        name: String(body.name).trim(),
        location: String(body.location || "待上架").trim(),
        quantity: Math.max(0, quantity),
        locked: Number(body.locked || 0),
        updatedAt: now()
      });
    }
    await writeDb(db);
    return sendJson(res, 201, { inventory: db.inventory });
  }

  const requestStatusMatch = url.pathname.match(/^\/api\/admin\/requests\/([^/]+)\/status$/);
  if (requestStatusMatch && req.method === "PATCH") {
    assertRole(auth, "admin");
    const request = db.requests.find((item) => item.id === requestStatusMatch[1]);
    if (!request) return sendJson(res, 404, { error: "申请单不存在" });
    const status = ["pending", "approved", "processing", "done", "rejected"].includes(body.status)
      ? body.status
      : "pending";
    request.status = status;
    request.adminNote = String(body.adminNote || request.adminNote || "").trim();
    request.updatedAt = now();
    await writeDb(db);
    return sendJson(res, 200, { request });
  }

  return sendJson(res, 404, { error: "接口不存在" });
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/admin") {
    res.writeHead(302, { location: "/" });
    res.end();
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    await stat(filePath);
    res.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] || "application/octet-stream"
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "服务器错误" });
  }
});

server.listen(PORT, () => {
  console.log(`(주)보쥬 running at http://localhost:${PORT}`);
  console.log("Admin: admin / admin123");
  console.log("Client demo: client / client123");
});
