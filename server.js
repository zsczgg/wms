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
      productInternalId: "1700000000001",
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
      productInternalId: "1700000000002",
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
  auditLogs: [],
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
  const db = JSON.parse(await readFile(DB_FILE, "utf-8"));
  let changed = false;
  if (!Array.isArray(db.auditLogs)) {
    db.auditLogs = [];
    changed = true;
  }
  if (Array.isArray(db.inventory)) {
    for (const item of db.inventory) {
      if (!item.status) {
        item.status = "normal";
        changed = true;
      }
      if (!item.productInternalId) {
        item.productInternalId = nextProductInternalId(db);
        appendAuditLog(db, {
          actorId: "system",
          action: "product.id.backfill",
          entityType: "product",
          entityId: item.id,
          productInternalId: item.productInternalId,
          summary: `系统为商品 ${item.sku || item.name || item.id} 补生成内部产品ID`,
          snapshot: item
        });
        changed = true;
      }
    }
  }
  if (changed) await writeDb(db);
  return db;
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

function adminUser(user) {
  return { ...publicUser(user), password: user.password || "" };
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
  if (["product_create", "inbound", "return", "dropship"].includes(type)) return type;
  return "inbound";
}

function typeLabel(type) {
  return { product_create: "新增商品", inbound: "入库", return: "退仓", dropship: "代发" }[type] || "申请";
}

function requestTitle(type, quantity, productName) {
  if (type === "product_create") return `${typeLabel(type)} ${productName || "货品"}`;
  return `${typeLabel(type)} ${Number(quantity || 0)} 件 ${productName || "货品"}`;
}

function normalizeSku(value) {
  return String(value || "").trim();
}

function findInventoryItem(db, ownerId, sku) {
  return db.inventory.find((item) => item.ownerId === ownerId && item.sku === normalizeSku(sku));
}

function inventoryStatus(value) {
  return value === "frozen" ? "frozen" : "normal";
}

function createInventoryItem(db, body, actorId) {
  const item = {
    id: randomUUID(),
    productInternalId: nextProductInternalId(db),
    ownerId: String(body.ownerId).trim(),
    sku: normalizeSku(body.sku),
    name: String(body.name || body.productName || "").trim(),
    location: String(body.location || "待上架").trim(),
    quantity: Math.max(0, Number(body.quantity || 0)),
    locked: Number(body.locked || 0),
    status: inventoryStatus(body.status),
    updatedAt: now()
  };
  db.inventory.push(item);
  appendAuditLog(db, {
    actorId,
    action: "product.create",
    entityType: "product",
    entityId: item.id,
    productInternalId: item.productInternalId,
    summary: `新增商品 ${item.productInternalId} / ${item.sku}`,
    snapshot: item
  });
  return item;
}

function now() {
  return new Date().toISOString();
}

function nextProductInternalId(db) {
  const used = new Set((db.inventory || []).map((item) => String(item.productInternalId || "")));
  for (const log of db.auditLogs || []) {
    if (log.productInternalId) used.add(String(log.productInternalId));
    if (log.snapshot?.productInternalId) used.add(String(log.snapshot.productInternalId));
  }
  let candidate = Date.now();
  while (used.has(String(candidate).padStart(13, "0").slice(-13))) {
    candidate += 1;
  }
  return String(candidate).padStart(13, "0").slice(-13);
}

function appendAuditLog(db, entry) {
  if (!Array.isArray(db.auditLogs)) db.auditLogs = [];
  db.auditLogs.push({
    id: randomUUID(),
    createdAt: now(),
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    productInternalId: entry.productInternalId || "",
    summary: entry.summary || "",
    snapshot: entry.snapshot || null
  });
}

function actorInfo(db, actorId) {
  const user = db.users.find((item) => item.id === actorId);
  return user
    ? { id: user.id, username: user.username, name: user.name, company: user.company, role: user.role }
    : { id: actorId, username: actorId, name: actorId, company: "", role: "" };
}

function withLogActors(db, logs) {
  return logs.map((log) => ({ ...log, actor: actorInfo(db, log.actorId) }));
}

function filterAuditLogs(logs, url) {
  const query = String(url.searchParams.get("query") || "").trim().toLowerCase();
  const from = String(url.searchParams.get("from") || "").trim();
  const to = String(url.searchParams.get("to") || "").trim();
  return logs
    .filter((log) => {
      const createdAt = log.createdAt || "";
      if (from && createdAt < `${from}T00:00:00.000Z`) return false;
      if (to && createdAt > `${to}T23:59:59.999Z`) return false;
      if (!query) return true;
      return JSON.stringify(log).toLowerCase().includes(query);
    })
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
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
    const type = normalizeRequestType(body.type);
    requireFields(body, type === "product_create" ? ["sku", "productName"] : ["type", "sku", "productName", "quantity"]);
    const product = findInventoryItem(db, auth.user.id, body.sku);
    if (type === "product_create" && product) {
      return sendJson(res, 409, { error: "该商品已经存在，请直接创建入库单" });
    }
    if (type !== "product_create" && !product) {
      return sendJson(res, 400, { error: "请先申请新增商品，审批通过后才能创建该商品的入库单" });
    }
    if (type !== "product_create" && product.status !== "normal") {
      return sendJson(res, 400, { error: "该商品当前为冻结状态，暂时不能创建申请" });
    }
    const request = {
      id: randomUUID(),
      ownerId: auth.user.id,
      type,
      status: "pending",
      title: requestTitle(type, body.quantity, body.productName),
      sku: normalizeSku(body.sku),
      productName: String(body.productName || product?.name || "").trim(),
      quantity: type === "product_create" ? 0 : Math.max(1, Number(body.quantity || 1)),
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
    const clients = db.users.filter((item) => item.role === "client").map(adminUser);
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

  if (url.pathname === "/api/admin/logs" && req.method === "GET") {
    assertRole(auth, "admin");
    return sendJson(res, 200, { logs: withLogActors(db, filterAuditLogs(db.auditLogs || [], url)) });
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
    appendAuditLog(db, {
      actorId: auth.user.id,
      action: "client.create",
      entityType: "client",
      entityId: user.id,
      summary: `新增客户 ${user.company}（${user.username}）`,
      snapshot: adminUser(user)
    });
    await writeDb(db);
    return sendJson(res, 201, { user: adminUser(user) });
  }

  const clientMatch = url.pathname.match(/^\/api\/admin\/clients\/([^/]+)$/);
  if (clientMatch && req.method === "PATCH") {
    assertRole(auth, "admin");
    const user = db.users.find((item) => item.id === clientMatch[1] && item.role === "client");
    if (!user) return sendJson(res, 404, { error: "客户不存在" });
    const username = String(body.username || user.username).trim();
    if (db.users.some((item) => item.id !== user.id && item.username === username)) {
      return sendJson(res, 409, { error: "登录账号已存在" });
    }
    const before = adminUser(user);
    user.company = String(body.company || user.company).trim();
    user.name = String(body.name || user.name).trim();
    user.username = username;
    if (String(body.password || "").trim()) user.password = String(body.password).trim();
    if (["active", "disabled"].includes(body.status)) user.status = body.status;
    user.updatedAt = now();
    appendAuditLog(db, {
      actorId: auth.user.id,
      action: "client.update",
      entityType: "client",
      entityId: user.id,
      summary: `修改客户 ${user.company}（${user.username}）`,
      snapshot: { before, after: adminUser(user) }
    });
    await writeDb(db);
    return sendJson(res, 200, { user: adminUser(user) });
  }

  if (clientMatch && req.method === "DELETE") {
    assertRole(auth, "admin");
    const index = db.users.findIndex((item) => item.id === clientMatch[1] && item.role === "client");
    if (index === -1) return sendJson(res, 404, { error: "客户不存在" });
    const [user] = db.users.splice(index, 1);
    db.sessions = db.sessions.filter((item) => item.userId !== user.id);
    appendAuditLog(db, {
      actorId: auth.user.id,
      action: "client.delete",
      entityType: "client",
      entityId: user.id,
      summary: `删除客户 ${user.company}（${user.username}）`,
      snapshot: adminUser(user)
    });
    await writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === "/api/admin/inventory" && req.method === "POST") {
    assertRole(auth, "admin");
    requireFields(body, ["ownerId", "sku", "name", "quantity"]);
    const quantity = Number(body.quantity || 0);
    const existing = findInventoryItem(db, String(body.ownerId).trim(), body.sku);
    const before = existing ? { ...existing } : null;
    if (existing) {
      existing.quantity = Math.max(0, Number(existing.quantity || 0) + quantity);
      existing.name = String(body.name).trim();
      existing.location = String(body.location || existing.location || "待上架").trim();
      existing.updatedAt = now();
    } else {
      createInventoryItem(db, body, auth.user.id);
    }
    const changedItem = findInventoryItem(db, String(body.ownerId).trim(), body.sku);
    if (existing) {
      appendAuditLog(db, {
        actorId: auth.user.id,
        action: "product.update",
        entityType: "product",
        entityId: changedItem?.id || "",
        productInternalId: changedItem?.productInternalId || "",
        summary: `更新商品 ${changedItem?.productInternalId || ""} / ${changedItem?.sku || ""}`,
        snapshot: { before, after: changedItem || null }
      });
    }
    await writeDb(db);
    return sendJson(res, 201, { inventory: db.inventory });
  }

  const inventoryMatch = url.pathname.match(/^\/api\/admin\/inventory\/([^/]+)$/);
  if (inventoryMatch && req.method === "DELETE") {
    assertRole(auth, "admin");
    const index = db.inventory.findIndex((item) => item.id === inventoryMatch[1]);
    if (index === -1) return sendJson(res, 404, { error: "商品不存在" });
    const [item] = db.inventory.splice(index, 1);
    appendAuditLog(db, {
      actorId: auth.user.id,
      action: "product.delete",
      entityType: "product",
      entityId: item.id,
      productInternalId: item.productInternalId,
      summary: `删除商品 ${item.productInternalId || ""} / ${item.sku}`,
      snapshot: item
    });
    await writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  const inventoryStatusMatch = url.pathname.match(/^\/api\/admin\/inventory\/([^/]+)\/status$/);
  if (inventoryStatusMatch && req.method === "PATCH") {
    assertRole(auth, "admin");
    const item = db.inventory.find((entry) => entry.id === inventoryStatusMatch[1]);
    if (!item) return sendJson(res, 404, { error: "商品不存在" });
    const before = { ...item };
    item.status = inventoryStatus(body.status);
    item.updatedAt = now();
    appendAuditLog(db, {
      actorId: auth.user.id,
      action: "product.status.update",
      entityType: "product",
      entityId: item.id,
      productInternalId: item.productInternalId,
      summary: `修改商品状态 ${item.productInternalId || ""} / ${item.sku}`,
      snapshot: { before, after: item }
    });
    await writeDb(db);
    return sendJson(res, 200, { item });
  }

  const requestStatusMatch = url.pathname.match(/^\/api\/admin\/requests\/([^/]+)\/status$/);
  if (requestStatusMatch && req.method === "PATCH") {
    assertRole(auth, "admin");
    const request = db.requests.find((item) => item.id === requestStatusMatch[1]);
    if (!request) return sendJson(res, 404, { error: "申请单不存在" });
    const status = ["pending", "approved", "processing", "done", "rejected"].includes(body.status)
      ? body.status
      : "pending";
    const before = { ...request };
    if (request.type === "product_create" && ["approved", "processing", "done"].includes(status)) {
      const existing = findInventoryItem(db, request.ownerId, request.sku);
      if (!existing) {
        createInventoryItem(
          db,
          {
            ownerId: request.ownerId,
            sku: request.sku,
            name: request.productName,
            quantity: 0,
            location: "待上架"
          },
          auth.user.id
        );
      } else {
        const productBefore = { ...existing };
        existing.status = "normal";
        existing.updatedAt = now();
        appendAuditLog(db, {
          actorId: auth.user.id,
          action: "product.status.update",
          entityType: "product",
          entityId: existing.id,
          productInternalId: existing.productInternalId,
          summary: `修改商品状态 ${existing.productInternalId || ""} / ${existing.sku}`,
          snapshot: { before: productBefore, after: existing }
        });
      }
    }
    if (request.type === "product_create" && before.status !== "rejected" && status === "rejected") {
      const product = findInventoryItem(db, request.ownerId, request.sku);
      if (product) {
        const productBefore = { ...product };
        product.status = "frozen";
        product.updatedAt = now();
        appendAuditLog(db, {
          actorId: auth.user.id,
          action: "product.status.update",
          entityType: "product",
          entityId: product.id,
          productInternalId: product.productInternalId,
          summary: `修改商品状态 ${product.productInternalId || ""} / ${product.sku}`,
          snapshot: { before: productBefore, after: product }
        });
      }
    }
    request.status = status;
    request.adminNote = String(body.adminNote || request.adminNote || "").trim();
    request.updatedAt = now();
    appendAuditLog(db, {
      actorId: auth.user.id,
      action: "request.status.update",
      entityType: "request",
      entityId: request.id,
      summary: `修改申请状态 ${request.title}`,
      snapshot: { before, after: request }
    });
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
