const app = document.querySelector("#app");
const APP_NAME = "(주)보쥬";

const state = {
  token: localStorage.getItem("wms.token") || "",
  user: JSON.parse(localStorage.getItem("wms.user") || "null"),
  data: null,
  logs: [],
  logFilters: { query: "", from: "", to: "", role: "" },
  editingClientId: "",
  editingAddressId: "",
  showClientCreate: false,
  showProductCreate: false,
  showClientProductCreate: false,
  adminSearch: { requests: "", inventory: "", clients: "" },
  requestCategory: "all",
  productPicker: { open: false, type: "", query: "" },
  addressPicker: { open: false, formType: "", query: "" },
  addressSearch: "",
  productSearch: "",
  selectedProductSkus: {},
  requestSelections: { inbound: {}, return: {}, dropship: {} },
  clientOverviewLayout: null,
  view: "overview"
};

const overviewModuleDefaults = [
  { id: "stats", size: "large" },
  { id: "inventory", size: "large" },
  { id: "recent", size: "medium" }
];

const overviewSizeMap = {
  small: "小",
  medium: "中",
  large: "大"
};

const statusMap = {
  pending: "待处理",
  approved: "已通过",
  processing: "处理中",
  done: "已完成",
  rejected: "已驳回"
};

const typeMap = {
  product_create: "新增商品",
  product_delete: "删除商品",
  inbound: "入库",
  return: "退仓",
  dropship: "代发"
};

const clientStatusMap = {
  active: "启用",
  disabled: "停用"
};

const productStatusMap = {
  normal: "正常",
  frozen: "冻结"
};

const logActionMap = {
  "product.id.backfill": "补生成商品内部ID",
  "product.create": "新增商品",
  "product.update": "更新商品",
  "product.delete": "删除商品",
  "product.status.update": "修改商品状态",
  "client.create": "新增客户",
  "client.update": "修改客户",
  "client.delete": "删除客户",
  "address.create": "新增地址",
  "address.update": "修改地址",
  "address.delete": "删除地址",
  "request.status.update": "修改申请状态"
};

const logEntityMap = {
  product: "商品",
  client: "客户",
  address: "地址",
  request: "申请"
};

function h(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function animatedBrandText() {
  return Array.from(APP_NAME)
    .map((char, index) => `<span style="--i: ${index}">${h(char)}</span>`)
    .join("");
}

function fmtDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function fmtDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}年${pick("month")}月${pick("day")}日 ${pick("hour")}:${pick("minute")}:${pick("second")}`;
}

async function api(path, options = {}) {
  try {
    const res = await fetch(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || "请求失败，请稍后重试");
    return payload;
  } catch (error) {
    if (error?.message && !["Failed to fetch", "NetworkError when attempting to fetch resource."].includes(error.message)) {
      throw error;
    }
    throw new Error("网络连接失败，请确认本地服务已启动");
  }
}

function toast(message) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 2600);
}

function addRipple(event) {
  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  const ripple = document.createElement("span");
  ripple.className = "ripple";
  ripple.style.setProperty("--x", `${event.clientX - rect.left}px`);
  ripple.style.setProperty("--y", `${event.clientY - rect.top}px`);
  target.append(ripple);
  setTimeout(() => ripple.remove(), 650);
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("wms.token", token);
  localStorage.setItem("wms.user", JSON.stringify(user));
}

function clearSession() {
  state.token = "";
  state.user = null;
  state.data = null;
  state.clientOverviewLayout = null;
  localStorage.removeItem("wms.token");
  localStorage.removeItem("wms.user");
}

function overviewStorageKey() {
  return `wms.clientOverview.${state.user?.id || state.user?.username || "default"}`;
}

function normalizeOverviewLayout(layout) {
  const source = Array.isArray(layout) ? layout : [];
  const known = new Set(overviewModuleDefaults.map((item) => item.id));
  const normalized = source
    .filter((item) => known.has(item.id))
    .map((item) => ({
      id: item.id,
      size: overviewSizeMap[item.size] ? item.size : overviewModuleDefaults.find((entry) => entry.id === item.id).size
    }));
  for (const item of overviewModuleDefaults) {
    if (!normalized.some((entry) => entry.id === item.id)) normalized.push({ ...item });
  }
  return normalized;
}

function clientOverviewLayout() {
  if (state.clientOverviewLayout) return state.clientOverviewLayout;
  try {
    state.clientOverviewLayout = normalizeOverviewLayout(JSON.parse(localStorage.getItem(overviewStorageKey()) || "[]"));
  } catch {
    state.clientOverviewLayout = normalizeOverviewLayout([]);
  }
  return state.clientOverviewLayout;
}

function saveClientOverviewLayout(layout = state.clientOverviewLayout) {
  state.clientOverviewLayout = normalizeOverviewLayout(layout);
  localStorage.setItem(overviewStorageKey(), JSON.stringify(state.clientOverviewLayout));
}

function statCards(stats, role) {
  const items =
    role === "admin"
      ? [
          ["客户数", stats.clients],
          ["总 SKU", stats.skuCount],
          ["在仓件数", stats.totalQuantity],
          ["待处理", stats.pending]
        ]
      : [
          ["SKU 数", stats.skuCount],
          ["可见库存", stats.totalQuantity],
          ["锁定件数", stats.locked],
          ["申请待审", stats.pending]
        ];
  return `<div class="stats">${items
    .map(([label, value]) => `<article class="stat"><span>${label}</span><strong>${value}</strong></article>`)
    .join("")}</div>`;
}

function statusBadge(status) {
  return `<span class="status ${h(status)}">${statusMap[status] || status}</span>`;
}

function productStatusBadge(status) {
  const normalized = status === "frozen" ? "frozen" : "normal";
  return `<span class="status ${normalized === "normal" ? "done" : "rejected"}">${productStatusMap[normalized]}</span>`;
}

function requestSelection(type) {
  const current = state.requestSelections[type] || {};
  if (Array.isArray(current)) {
    state.requestSelections[type] = Object.fromEntries(current.map((sku) => [sku, 1]));
  }
  return state.requestSelections[type] || {};
}

function selectedSkus(type) {
  return Object.keys(requestSelection(type));
}

function addressText(address) {
  return `${address.label || ""} ${address.receiver || ""} ${address.phone || ""} ${address.address || ""}`.trim();
}

function addressDisplayName(address) {
  return address.label || address.receiver || address.address || "未命名地址";
}

function filteredAddresses(addresses = [], query = "") {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return addresses;
  return addresses.filter((item) => addressText(item).toLowerCase().includes(normalized));
}

function productSearchText(item) {
  return `${item.productInternalId || ""} ${item.sku || ""} ${item.name || ""} ${item.location || ""} ${productStatusMap[item.status] || item.status || ""}`.toLowerCase();
}

function filteredProducts(inventory = []) {
  const query = state.productSearch.trim().toLowerCase();
  if (!query) return inventory;
  return inventory.filter((item) => productSearchText(item).includes(query));
}

function selectedProductSkus() {
  return Object.keys(state.selectedProductSkus || {});
}

function normalInventoryItems() {
  return (state.data?.inventory || []).filter((item) => item.status !== "frozen");
}

function selectRequestProduct(type, sku, quantity = 1) {
  const selection = requestSelection(type);
  selection[sku] = Math.max(1, Number(quantity || selection[sku] || 1));
}

function unselectRequestProduct(type, sku) {
  delete requestSelection(type)[sku];
}

function clientStatusLabel(status) {
  return clientStatusMap[status] || status || "-";
}

function logSnapshotValue(log, key) {
  const snapshot = log.snapshot || {};
  return snapshot[key] || snapshot.after?.[key] || snapshot.before?.[key] || "";
}

function actorLabel(log) {
  const actor = log.actor || {};
  return actor.username ? `${actor.company || actor.name || actor.username}（${actor.username}）` : log.actorId || "系统";
}

function actorRoleLabel(log) {
  const role = log.actor?.role;
  if (role === "admin") return "管理操作";
  if (role === "client") return "客户操作";
  return "系统操作";
}

function displayValue(value) {
  if (value === undefined || value === null || value === "") return "空";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (productStatusMap[value]) return productStatusMap[value];
  if (statusMap[value]) return statusMap[value];
  if (clientStatusMap[value]) return clientStatusMap[value];
  return String(value);
}

const diffFieldLabels = {
  company: "客户公司",
  name: "名称",
  username: "登录账号",
  password: "密码",
  status: "状态",
  sku: "SKU",
  productName: "货品名称",
  quantity: "数量",
  location: "库位",
  locked: "锁定数",
  label: "地址名称",
  receiver: "收件人",
  phone: "联系电话",
  address: "详细地址",
  title: "标题",
  adminNote: "管理员备注"
};

function logDiffs(log) {
  const before = log.snapshot?.before;
  const after = log.snapshot?.after;
  if (!before || !after) return [];
  return Object.keys(diffFieldLabels)
    .filter((key) => JSON.stringify(before[key] ?? "") !== JSON.stringify(after[key] ?? ""))
    .map((key) => `${diffFieldLabels[key]}从“${displayValue(before[key])}”改成“${displayValue(after[key])}”`);
}

function logSummary(log) {
  const productId = log.productInternalId || logSnapshotValue(log, "productInternalId");
  const sku = logSnapshotValue(log, "sku");
  const company = logSnapshotValue(log, "company");
  const username = logSnapshotValue(log, "username");
  const diffs = logDiffs(log);
  if (diffs.length) return `${actorLabel(log)} ${diffs.join("，")}，时间是${fmtDateTime(log.createdAt)}`;
  if (log.action === "product.id.backfill") return `系统为商品 ${sku || productId || log.entityId} 补生成内部产品ID ${productId || "-"}`;
  if (log.action === "product.create") return `新增商品 ${productId || "-"} / ${sku || "-"}`;
  if (log.action === "product.update") return `更新商品 ${productId || "-"} / ${sku || "-"}`;
  if (log.action === "product.delete") return `删除商品 ${productId || "-"} / ${sku || "-"}`;
  if (log.action === "product.status.update") return `修改商品状态 ${productId || "-"} / ${sku || "-"}`;
  if (log.action === "client.create") return `新增客户 ${company || log.entityId}${username ? `（${username}）` : ""}`;
  if (log.action === "client.update") return `修改客户 ${company || log.entityId}${username ? `（${username}）` : ""}`;
  if (log.action === "client.delete") return `删除客户 ${company || log.entityId}${username ? `（${username}）` : ""}`;
  if (log.action === "address.create") return `${actorLabel(log)} 新增地址 ${logSnapshotValue(log, "label") || log.entityId}，时间是${fmtDateTime(log.createdAt)}`;
  if (log.action === "address.update") return `${actorLabel(log)} 修改地址 ${logSnapshotValue(log, "label") || log.entityId}，时间是${fmtDateTime(log.createdAt)}`;
  if (log.action === "address.delete") return `${actorLabel(log)} 删除地址 ${logSnapshotValue(log, "label") || log.entityId}，时间是${fmtDateTime(log.createdAt)}`;
  return log.summary || "系统记录";
}

function topbar() {
  const roleText = state.user.role === "admin" ? "管理员后台" : "客户工作台";
  return `
    <header class="topbar">
      <div class="brand">
        <div>
          <h1>${APP_NAME}</h1>
          <p>${h(state.user.company)} · ${roleText}</p>
        </div>
      </div>
      <div class="top-actions">
        <span class="pill">${h(state.user.name)} / ${h(state.user.username)}</span>
        <button class="btn ghost" data-action="logout">退出</button>
      </div>
    </header>
  `;
}

function nav(items) {
  return `<aside class="side">${items
    .map(
      (item) => `
        <button class="nav-btn ${state.view === item.id ? "active" : ""}" data-view="${item.id}">
          <span class="nav-glyph">${item.glyph}</span>
          <span>${item.label}</span>
        </button>`
    )
    .join("")}</aside>`;
}

function inventoryTable(inventory, clients = [], options = {}) {
  if (!inventory.length) return `<div class="empty">这里暂时没有库存。</div>`;
  const clientName = (id) => clients.find((client) => client.id === id)?.company || id;
  const showActions = options.adminActions || options.clientActions;
  const clientColumns = Boolean(options.clientActions);
  const productQuery = state.productSearch.trim().toLowerCase();
  return `
    <div class="table-wrap ${clientColumns ? "client-inventory-wrap" : ""}">
      <table>
        <thead>
          <tr>
            ${options.clientActions ? "<th>选择</th>" : ""}
            ${clients.length ? "<th>客户</th>" : ""}
            ${clientColumns ? "" : "<th>内部产品ID</th><th>SKU</th>"}
            <th>货品</th><th>状态</th>${clientColumns ? "" : "<th>库位</th>"}<th>库存</th><th>锁定</th>${clientColumns ? "" : "<th>更新时间</th>"}
            ${showActions ? `<th>${clientColumns ? "操作 / 更多" : "操作"}</th>` : ""}
          </tr>
        </thead>
        <tbody>
          ${inventory
            .map(
              (item) => {
                const searchable = productSearchText(item);
                return `
              <tr ${clientColumns ? `data-product-row="${h(searchable)}" class="${productQuery && !searchable.includes(productQuery) ? "hidden" : ""}"` : ""}>
                ${
                  options.clientActions
                    ? `<td><input type="checkbox" data-product-batch-sku="${h(item.sku)}" ${state.selectedProductSkus[item.sku] ? "checked" : ""} ${item.status === "frozen" ? "disabled" : ""} /></td>`
                    : ""
                }
                ${clients.length ? `<td>${h(clientName(item.ownerId))}</td>` : ""}
                ${clientColumns ? "" : `<td class="sku">${h(item.productInternalId || "-")}</td><td class="sku">${h(item.sku)}</td>`}
                <td>${h(item.name)}</td>
                <td>${productStatusBadge(item.status)}</td>
                ${clientColumns ? "" : `<td>${h(item.location || "待上架")}</td>`}
                <td>${Number(item.quantity || 0)}</td>
                <td>${Number(item.locked || 0)}</td>
                ${clientColumns ? "" : `<td>${fmtDate(item.updatedAt)}</td>`}
                ${
                  options.adminActions
                    ? `<td class="split-actions">
                        <button class="mini-btn" type="button" data-action="toggle-product-status" data-product-id="${h(item.id)}" data-status="${item.status === "frozen" ? "normal" : "frozen"}">${item.status === "frozen" ? "恢复正常" : "冻结"}</button>
                        <button class="mini-btn danger" type="button" data-action="delete-product" data-product-id="${h(item.id)}">删除</button>
                      </td>`
                    : options.clientActions
                      ? `<td class="inventory-actions-cell">
                          <details class="action-menu inline-menu">
                            <summary class="mini-btn">操作</summary>
                            <div class="action-menu-list">
                              <button type="button" data-action="product-row-request" data-request-type="dropship" data-sku="${h(item.sku)}" data-status="${h(item.status || "normal")}">代发</button>
                              <button type="button" data-action="product-row-request" data-request-type="inbound" data-sku="${h(item.sku)}" data-status="${h(item.status || "normal")}">入仓</button>
                              <button type="button" data-action="product-row-request" data-request-type="return" data-sku="${h(item.sku)}" data-status="${h(item.status || "normal")}">退仓</button>
                              <button class="danger" type="button" data-action="request-product-delete" data-sku="${h(item.sku)}" data-name="${h(item.name)}" data-quantity="${Number(item.quantity || 0)}">删除</button>
                            </div>
                          </details>
                          <details class="action-menu inline-menu">
                            <summary class="mini-btn">更多</summary>
                            <div class="action-menu-list info-menu-list">
                              <p><strong>SKU</strong><span>${h(item.sku || "-")}</span></p>
                              <p><strong>内部产品ID</strong><span>${h(item.productInternalId || "-")}</span></p>
                              <p><strong>库位</strong><span>${h(item.location || "待上架")}</span></p>
                              <p><strong>更新时间</strong><span>${fmtDate(item.updatedAt)}</span></p>
                            </div>
                          </details>
                        </td>`
                    : ""
                }
              </tr>`;
              }
            )
            .join("")}
        </tbody>
      </table>
      ${clientColumns ? `<div class="empty hidden" data-product-search-empty>没有匹配的商品。</div>` : ""}
    </div>
  `;
}

function clientProductBatchToolbar(inventory = []) {
  const normalItems = inventory.filter((item) => item.status !== "frozen");
  const selectedCount = selectedProductSkus().length;
  const allSelected = normalItems.length > 0 && normalItems.every((item) => state.selectedProductSkus[item.sku]);
  return `
    <div class="batch-toolbar">
      <input class="input search-input" data-product-search value="${h(state.productSearch)}" placeholder="搜索商品名、SKU、内部产品ID、库位" />
      <label class="checkline">
        <input type="checkbox" data-action="toggle-all-products" ${allSelected ? "checked" : ""} ${normalItems.length ? "" : "disabled"} />
        <span>全选正常商品</span>
      </label>
      <span class="pill">已选择 ${selectedCount} 个商品</span>
      <div class="split-actions">
        <button class="btn inverse compact" type="button" data-action="batch-product-request" data-request-type="dropship">批量代发</button>
        <button class="btn inverse compact" type="button" data-action="batch-product-request" data-request-type="inbound">批量入仓</button>
        <button class="btn inverse compact" type="button" data-action="batch-product-request" data-request-type="return">批量退仓</button>
      </div>
      <button class="mini-btn" type="button" data-action="clear-product-batch">清空选择</button>
    </div>
  `;
}

function requestList(requests, admin = false) {
  if (!requests.length) return `<div class="empty">还没有申请单。</div>`;
  return `<div class="request-list">${requests
    .map(
      (item) => `
      <article class="request-item">
        <header>
          <div>
            <h4>${h(typeMap[item.type] || item.type)} · ${h(item.title)}</h4>
            <p>${admin ? `申请人：${h(item.owner?.company || "")} · ` : ""}${h(item.sku)} · ${fmtDate(item.createdAt)}</p>
          </div>
          ${statusBadge(item.status)}
        </header>
          <p>${typeMap[item.type] || item.type}${["product_create", "product_delete"].includes(item.type) ? "" : ` / 数量 ${Number(item.quantity || 0)}`}${item.receiver ? ` / 收件人 ${h(item.receiver)}` : ""}</p>
        ${item.address ? `<p>${h(item.address)}</p>` : ""}
        ${item.note ? `<p>${h(item.note)}</p>` : ""}
        ${
          admin
            ? `<div class="split-actions" data-request-id="${h(item.id)}">
                <button class="mini-btn" data-status="approved">通过</button>
                <button class="mini-btn" data-status="processing">处理中</button>
                <button class="mini-btn" data-status="done">完成</button>
                <button class="mini-btn" data-status="rejected">驳回</button>
              </div>`
            : ""
        }
      </article>`
    )
    .join("")}</div>`;
}

function clientRequestForm(fixedType = "product_create") {
  const inventory = (state.data?.inventory || []).filter((item) => item.status !== "frozen");
  const selection = requestSelection(fixedType);
  const skus = selectedSkus(fixedType);
  const selectedItems = inventory.filter((item) => skus.includes(item.sku));
  if (fixedType === "product_create") {
    return `
      <form class="form" data-form="client-request">
        <input type="hidden" name="type" value="product_create" />
        <label>SKU <input class="input" name="sku" placeholder="例如 AURORA-CASE-01" required /></label>
        <label>货品名称 <input class="input" name="productName" placeholder="例如 磁吸手机壳" required /></label>
        <label>备注 <textarea class="textarea" name="note" placeholder="商品规格、包装要求、条码等"></textarea></label>
        <button class="btn primary" type="submit">提交新增商品申请</button>
      </form>
    `;
  }
  return `
    <form class="form" data-form="client-request">
      <input type="hidden" name="type" value="${h(fixedType)}" />
      <div class="picker-summary">
        <button class="btn inverse" type="button" data-action="open-product-picker" data-request-type="${h(fixedType)}">选择商品</button>
        <span>${selectedItems.length ? `已选择 ${selectedItems.length} 个商品` : "未选择商品"}</span>
      </div>
      <div class="selected-products">
        ${
          selectedItems.length
            ? selectedItems
                .map(
                  (item) => `
                  <div class="selected-product-row">
                    <span><strong>${h(item.sku)}</strong> / ${h(item.name)}</span>
                    <label>数量 <input class="input compact-input" name="quantity:${h(item.sku)}" type="number" min="1" value="${Number(selection[item.sku] || 1)}" required /></label>
                  </div>`
                )
                .join("")
            : `<span class="empty-inline">请从弹窗里选择一个或多个商品</span>`
        }
      </div>
      <label>物流单号 <input class="input" name="trackingNo" placeholder="入库时填写更方便" /></label>
      ${
        ["return", "dropship"].includes(fixedType)
          ? `<div class="picker-summary">
               <button class="btn inverse" type="button" data-action="open-address-picker" data-form-type="${h(fixedType)}">从地址库选择</button>
               <span>也可以手动填写地址</span>
             </div>
             <label>收件人 <input class="input" name="receiver" placeholder="${fixedType === "dropship" ? "代发收件人" : "退仓收件人"}" /></label>
             <label>联系电话 <input class="input" name="phone" placeholder="收件人电话" /></label>
             <label>收件地址 <textarea class="textarea" name="address" placeholder="${fixedType === "dropship" ? "代发收件地址" : "退仓地址"}"></textarea></label>`
          : ""
      }
      <label>备注 <textarea class="textarea" name="note" placeholder="包装要求、渠道、时效等"></textarea></label>
      <button class="btn primary" type="submit">提交申请</button>
    </form>
  `;
}

function adminClientForm() {
  return `
    <form class="form" data-form="admin-client">
      <label>客户公司 <input class="input" name="company" required placeholder="客户品牌或公司名" /></label>
      <label>联系人 <input class="input" name="name" required placeholder="联系人姓名" /></label>
      <label>登录账号 <input class="input" name="username" required placeholder="给客户的账号" /></label>
      <label>初始密码 <input class="input" name="password" required placeholder="给客户的密码" /></label>
      <button class="btn primary" type="submit">创建子账号</button>
    </form>
  `;
}

function addressForm(address = null) {
  const editing = Boolean(address);
  return `
    <form class="form" data-form="${editing ? "client-address-edit" : "client-address"}" ${editing ? `data-address-id="${h(address.id)}"` : ""} novalidate>
      <label>地址名称 <input class="input" name="label" value="${h(address?.label || "")}" placeholder="例如 华东退货仓 / 张三家" /></label>
      <label>收件人 <input class="input" name="receiver" value="${h(address?.receiver || "")}" placeholder="收件人姓名" /></label>
      <label>联系电话 <input class="input" name="phone" value="${h(address?.phone || "")}" placeholder="手机号或座机" /></label>
      <label>详细地址 <textarea class="textarea" name="address" placeholder="省市区、街道、门牌号">${h(address?.address || "")}</textarea></label>
      <div class="form-actions">
        <button class="btn primary" type="submit">${editing ? "保存地址" : "新增地址"}</button>
        ${editing ? `<button class="btn inverse" type="button" data-action="cancel-address-edit">取消</button>` : ""}
      </div>
    </form>
  `;
}

function addressLibrary(addresses = []) {
  const query = state.addressSearch.trim().toLowerCase();
  return `
    <div class="toolbar address-toolbar">
      <input class="input search-input" data-address-library-search value="${h(state.addressSearch)}" placeholder="搜索地址名称、收件人、电话、详细地址" />
    </div>
    <div class="address-list">
      ${
        addresses.length
          ? addresses
              .map((item) => {
                const editing = state.editingAddressId === item.id;
                const searchable = addressText(item).toLowerCase();
                return `
                  <article class="address-item ${query && !searchable.includes(query) ? "hidden" : ""}" data-address-library-row="${h(searchable)}">
                    <header>
                      <div>
                        <h4>${h(addressDisplayName(item))}</h4>
                        <p>${h(item.receiver || "未填写收件人")}${item.phone ? ` · ${h(item.phone)}` : ""}</p>
                      </div>
                      <div class="split-actions">
                        <button class="mini-btn" type="button" data-action="edit-address" data-address-id="${h(item.id)}">编辑</button>
                        <button class="mini-btn danger" type="button" data-action="delete-address" data-address-id="${h(item.id)}" data-address-label="${h(addressDisplayName(item))}">删除</button>
                      </div>
                    </header>
                    <p>${h(item.address || "未填写详细地址")}</p>
                    ${editing ? `<div class="inline-editor">${addressForm(item)}</div>` : ""}
                  </article>
                `;
              })
              .join("")
          : `<div class="empty">还没有保存地址。</div>`
      }
      ${addresses.length ? `<div class="empty hidden" data-address-library-empty>没有匹配的地址。</div>` : ""}
    </div>
  `;
}

function containsQuery(item, query) {
  if (!query) return true;
  return JSON.stringify(item).toLowerCase().includes(query.trim().toLowerCase());
}

function searchBox(scope, placeholder = "搜索") {
  return `<input class="input search-input" data-search="${h(scope)}" value="${h(state.adminSearch[scope] || "")}" placeholder="${h(placeholder)}" />`;
}

function overviewSizeControls(module) {
  return `<div class="module-tools" aria-label="模块大小">
    ${Object.entries(overviewSizeMap)
      .map(
        ([size, label]) =>
          `<button class="mini-btn ${module.size === size ? "active" : ""}" type="button" data-overview-size="${size}" data-module-id="${h(module.id)}">${label}</button>`
      )
      .join("")}
  </div>`;
}

function overviewModule(module, title, body) {
  return `
    <article class="card overview-module overview-${h(module.size)}" draggable="true" data-overview-module="${h(module.id)}">
      <div class="card-head overview-module-head">
        <div>
          <h3>${h(title)}</h3>
          <p>拖动模块调整顺序</p>
        </div>
        ${overviewSizeControls(module)}
      </div>
      <div class="card-body">${body}</div>
    </article>
  `;
}

function clientOverviewGrid(data) {
  const bodyById = {
    stats: () => overviewModule(clientOverviewLayout().find((item) => item.id === "stats"), "数据概览", statCards(data.stats, "client")),
    inventory: () => overviewModule(clientOverviewLayout().find((item) => item.id === "inventory"), "我的库存", inventoryTable(data.inventory)),
    recent: () => overviewModule(clientOverviewLayout().find((item) => item.id === "recent"), "最近申请", requestList(data.requests.slice(0, 5)))
  };
  return `<div class="overview-grid">${clientOverviewLayout().map((module) => bodyById[module.id]?.() || "").join("")}</div>`;
}

function adminClientList(clients) {
  if (!clients.length) return `<div class="empty">还没有客户账号。</div>`;
  return `<div class="client-list">${clients
    .map(
      (client) => {
        const editing = state.editingClientId === client.id;
        return `
      <article class="client-row" data-client-id="${h(client.id)}">
        <div class="client-row-main">
          <div>
            <h4>${h(client.company)}</h4>
            <p>${h(client.name)} · ${h(client.username)}</p>
          </div>
          <span class="status ${client.status === "active" ? "done" : "rejected"}">${h(clientStatusLabel(client.status))}</span>
        </div>
        <div class="client-row-actions">
          <button class="mini-btn" type="button" data-action="edit-client" data-client-id="${h(client.id)}">${editing ? "收起" : "编辑"}</button>
          <button class="mini-btn danger" type="button" data-action="delete-client" data-client-id="${h(client.id)}">删除</button>
        </div>
        ${
          editing
            ? `<form class="client-edit-form" data-form="admin-client-edit" data-client-id="${h(client.id)}">
                <div class="client-edit-grid">
                  <label>客户公司 <input class="input" name="company" value="${h(client.company)}" required /></label>
                  <label>联系人 <input class="input" name="name" value="${h(client.name)}" required /></label>
                  <label>登录账号 <input class="input" name="username" value="${h(client.username)}" required /></label>
                  <label>密码 <input class="input" name="password" value="${h(client.password || "")}" required /></label>
                  <label>状态
                    <select class="select" name="status">
                      <option value="active" ${client.status === "active" ? "selected" : ""}>启用</option>
                      <option value="disabled" ${client.status === "disabled" ? "selected" : ""}>停用</option>
                    </select>
                  </label>
                </div>
                <div class="form-actions">
                  <button class="btn primary" type="submit">保存客户信息</button>
                  <button class="btn inverse" type="button" data-action="cancel-client-edit">取消</button>
                </div>
              </form>`
            : ""
        }
      </article>`;
      }
    )
    .join("")}</div>`;
}

function logSearchForm() {
  return `
    <form class="form log-filter" data-form="admin-log-filter">
      <label>搜索 <input class="input" name="query" value="${h(state.logFilters.query)}" placeholder="产品ID / SKU / 客户 / 操作" /></label>
      <label>开始日期 <input class="input" name="from" type="date" value="${h(state.logFilters.from)}" /></label>
      <label>结束日期 <input class="input" name="to" type="date" value="${h(state.logFilters.to)}" /></label>
      <label>操作来源
        <select class="select" name="role">
          <option value="" ${state.logFilters.role ? "" : "selected"}>全部</option>
          <option value="client" ${state.logFilters.role === "client" ? "selected" : ""}>客户操作</option>
          <option value="admin" ${state.logFilters.role === "admin" ? "selected" : ""}>管理操作</option>
        </select>
      </label>
      <button class="btn primary" type="submit">查询日志</button>
    </form>
  `;
}

function auditLogList(logs) {
  if (!logs.length) return `<div class="empty">没有匹配的日志记录。</div>`;
  return `<div class="request-list">${logs
    .map(
      (log) => `
      <article class="request-item">
        <header>
          <div>
            <h4>${h(logActionMap[log.action] || log.action || "系统记录")}</h4>
            <p><span class="source-badge">${h(actorRoleLabel(log))}</span> ${h(actorLabel(log))} · ${fmtDateTime(log.createdAt)} · ${h(logEntityMap[log.entityType] || log.entityType || "-")} · ${h(log.productInternalId || log.entityId || "")}</p>
          </div>
          <span class="status done">已锁定</span>
        </header>
        <p>${h(logSummary(log))}</p>
      </article>`
    )
    .join("")}</div>`;
}

function adminInventoryForm(clients) {
  return `
    <form class="form" data-form="admin-inventory">
      <label>所属客户
        <select class="select" name="ownerId" required>
          ${clients.map((client) => `<option value="${h(client.id)}">${h(client.company)} / ${h(client.name)}</option>`).join("")}
        </select>
      </label>
      <label>SKU <input class="input" name="sku" required placeholder="货品 SKU" /></label>
      <label>货品名称 <input class="input" name="name" required placeholder="货品名称" /></label>
      <label>数量增减 <input class="input" name="quantity" type="number" required value="0" /></label>
      <label>库位 <input class="input" name="location" placeholder="例如 A-03-02" /></label>
      <button class="btn primary" type="submit">更新库存</button>
    </form>
  `;
}

function inventoryToolbar() {
  return `
    <div class="toolbar">
      <button class="btn primary compact" type="button" data-action="toggle-product-create">${state.showProductCreate ? "收起新增商品" : "新增商品"}</button>
    </div>
  `;
}

function requestFilterBar() {
  const items = [
    ["all", "全部"],
    ["product_create", "新增商品"],
    ["product_delete", "删除商品"],
    ["inbound", "入库"],
    ["return", "退仓"],
    ["dropship", "代发"]
  ];
  return `
    <div class="filter-row">
      ${searchBox("requests", "搜索申请人、SKU、商品名")}
      <div class="segmented">
        ${items
          .map(
            ([id, label]) =>
              `<button class="mini-btn ${state.requestCategory === id ? "active" : ""}" type="button" data-request-category="${id}">${label}</button>`
          )
          .join("")}
      </div>
    </div>
  `;
}

function productPickerModal() {
  if (!state.productPicker.open) return "";
  const type = state.productPicker.type;
  const query = state.productPicker.query.trim().toLowerCase();
  const selected = new Set(selectedSkus(type));
  const products = (state.data?.inventory || [])
    .filter((item) => item.status !== "frozen");
  return `
    <div class="modal active" data-product-picker-modal>
      <div class="modal-panel picker-panel" role="dialog" aria-modal="true" aria-labelledby="productPickerTitle">
        <div class="card-head">
          <div>
            <h3 id="productPickerTitle">选择商品</h3>
            <p>可多选，冻结商品不会出现在这里。</p>
          </div>
          <button class="icon-button modal-close" type="button" data-action="close-product-picker" aria-label="关闭">×</button>
        </div>
        <div class="card-body picker-body">
          <input class="input" data-product-picker-search value="${h(state.productPicker.query)}" placeholder="搜索 SKU、商品名、内部产品ID" />
          <div class="picker-list">
            ${
              products.length
                ? products
                    .map(
                      (item) => `
                      <label class="picker-row ${query && !`${item.sku} ${item.name} ${item.productInternalId || ""}`.toLowerCase().includes(query) ? "hidden" : ""}" data-picker-row="${h(`${item.sku} ${item.name} ${item.productInternalId || ""}`.toLowerCase())}">
                        <input type="checkbox" data-picker-sku="${h(item.sku)}" ${selected.has(item.sku) ? "checked" : ""} />
                        <span>
                          <strong>${h(item.sku)} / ${h(item.name)}</strong>
                          <small>${h(item.productInternalId || "-")} · 库存 ${Number(item.quantity || 0)}</small>
                        </span>
                      </label>`
                    )
                    .join("")
                : `<div class="empty">没有匹配的商品。</div>`
            }
          </div>
          <div class="form-actions">
            <button class="btn primary" type="button" data-action="close-product-picker">完成选择</button>
            <button class="btn inverse" type="button" data-action="clear-product-picker">清空选择</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function addressPickerModal() {
  if (!state.addressPicker.open) return "";
  const addresses = state.data?.addresses || [];
  const query = state.addressPicker.query.trim().toLowerCase();
  return `
    <div class="modal active" data-address-picker-modal>
      <div class="modal-panel picker-panel" role="dialog" aria-modal="true" aria-labelledby="addressPickerTitle">
        <div class="card-head">
          <div>
            <h3 id="addressPickerTitle">选择地址</h3>
            <p>搜索并选择一个常用地址，系统会自动带入收件信息。</p>
          </div>
          <button class="icon-button modal-close" type="button" data-action="close-address-picker" aria-label="关闭">×</button>
        </div>
        <div class="card-body picker-body">
          <input class="input" data-address-picker-search value="${h(state.addressPicker.query)}" placeholder="搜索地址名称、收件人、电话、详细地址" />
          <div class="picker-list">
            ${
              addresses.length
                ? addresses
                    .map(
                      (item) => {
                        const searchable = addressText(item).toLowerCase();
                        return `
                        <button class="address-picker-row ${query && !searchable.includes(query) ? "hidden" : ""}" type="button" data-action="select-address" data-address-id="${h(item.id)}" data-address-picker-row="${h(searchable)}">
                          <strong>${h(addressDisplayName(item))}</strong>
                          <span>${h(item.receiver || "未填写收件人")}${item.phone ? ` · ${h(item.phone)}` : ""}</span>
                          <small>${h(item.address || "未填写详细地址")}</small>
                        </button>`;
                      }
                    )
                    .join("")
                : `<div class="empty">还没有保存地址。</div>`
            }
            ${addresses.length ? `<div class="empty hidden" data-address-picker-empty>没有匹配的地址。</div>` : ""}
          </div>
        </div>
      </div>
    </div>
  `;
}

function filteredRequests(requests) {
  return requests.filter((item) => {
    const categoryOk = state.requestCategory === "all" || item.type === state.requestCategory;
    return categoryOk && containsQuery(item, state.adminSearch.requests || "");
  });
}

function clientDashboard() {
  const data = state.data;
  const sections = {
    overview: `
      <section class="section active">
        <div class="section-head"><div><h2>仓库概览</h2><p>你的库存、锁定数量和最近申请都在这里。</p></div></div>
        ${clientOverviewGrid(data)}
      </section>`,
    dropship: `
      <section class="section active">
        <div class="section-head"><div><h2>代发申请</h2><p>从已正常启用的商品里选择并提交代发。</p></div></div>
        <div class="grid-2">
          <article class="card"><div class="card-head"><h3>新代发</h3></div><div class="card-body">${clientRequestForm("dropship")}</div></article>
          <article class="card"><div class="card-head"><h3>代发记录</h3></div><div class="card-body">${requestList(data.requests.filter((item) => item.type === "dropship"))}</div></article>
        </div>
      </section>`,
    inbound: `
      <section class="section active">
        <div class="section-head"><div><h2>入仓申请</h2><p>商品审批通过且状态正常后，才能创建入仓申请。</p></div></div>
        <div class="grid-2">
          <article class="card"><div class="card-head"><h3>新入仓</h3></div><div class="card-body">${clientRequestForm("inbound")}</div></article>
          <article class="card"><div class="card-head"><h3>入仓记录</h3></div><div class="card-body">${requestList(data.requests.filter((item) => item.type === "inbound"))}</div></article>
        </div>
      </section>`,
    return: `
      <section class="section active">
        <div class="section-head"><div><h2>退仓申请</h2><p>从已正常启用的商品里选择并提交退仓。</p></div></div>
        <div class="grid-2">
          <article class="card"><div class="card-head"><h3>新退仓</h3></div><div class="card-body">${clientRequestForm("return")}</div></article>
          <article class="card"><div class="card-head"><h3>退仓记录</h3></div><div class="card-body">${requestList(data.requests.filter((item) => item.type === "return"))}</div></article>
        </div>
      </section>`,
    addresses: `
      <section class="section active">
        <div class="section-head"><div><h2>地址库</h2><p>常用收货地址可直接维护，退仓申请时一键带入。</p></div></div>
        <div class="grid-2">
          <article class="card"><div class="card-head"><h3>新增地址</h3></div><div class="card-body">${addressForm()}</div></article>
          <article class="card"><div class="card-head"><h3>常用地址</h3></div><div class="card-body">${addressLibrary(data.addresses || [])}</div></article>
        </div>
      </section>`,
    products: `
      <section class="section active">
        <div class="section-head"><div><h2>商品和库存</h2><p>先申请新增商品，审批通过且状态正常后再创建入仓、退仓或代发。</p></div></div>
        <article class="card">
          <div class="card-head"><h3>所有商品和库存</h3></div>
          <div class="card-body">${clientProductBatchToolbar(data.inventory)}</div>
          ${inventoryTable(data.inventory, [], { clientActions: true })}
        </article>
        <article class="card">
          <div class="card-head">
            <h3>申请新增商品</h3>
            <button class="btn primary compact" type="button" data-action="toggle-client-product-create">${state.showClientProductCreate ? "收起" : "新增商品"}</button>
          </div>
          ${state.showClientProductCreate ? `<div class="card-body">${clientRequestForm("product_create")}</div>` : ""}
        </article>
        <article class="card"><div class="card-head"><h3>商品申请记录</h3></div><div class="card-body">${requestList(data.requests.filter((item) => ["product_create", "product_delete"].includes(item.type)))}</div></article>
      </section>`
  };
  return `
    <div class="shell">
      ${topbar()}
      <div class="dashboard">
        ${nav([
          { id: "overview", label: "仓库概览", glyph: "OV" },
          { id: "dropship", label: "代发申请", glyph: "DS" },
          { id: "inbound", label: "入仓申请", glyph: "IN" },
          { id: "return", label: "退仓申请", glyph: "RT" },
          { id: "addresses", label: "地址库", glyph: "AD" },
          { id: "products", label: "商品和库存", glyph: "SK" }
        ])}
        <div class="content">${sections[state.view] || sections.overview}</div>
        ${productPickerModal()}
        ${addressPickerModal()}
      </div>
    </div>`;
}

function adminDashboard() {
  const data = state.data;
  const searchedClients = data.clients.filter((item) => containsQuery(item, state.adminSearch.clients || ""));
  const searchedInventory = data.inventory.filter((item) => containsQuery(item, state.adminSearch.inventory || ""));
  const searchedRequests = filteredRequests(data.requests);
  const sections = {
    overview: `
      <section class="section active">
        <div class="section-head"><div><h2>运营总览</h2><p>管理员处理客户、库存和申请单。</p></div></div>
        ${statCards(data.stats, "admin")}
        <div class="grid-2">
          <article class="card"><div class="card-head"><h3>待处理申请</h3></div><div class="card-body">${requestList(
            data.requests.filter((item) => item.status === "pending"),
            true
          )}</div></article>
          <article class="card"><div class="card-head"><h3>子账号</h3></div><div class="card-body">${clientCards(searchedClients)}</div></article>
        </div>
      </section>`,
    clients: `
      <section class="section active">
        <div class="section-head"><div><h2>客户子账号</h2><p>为每个客户分配独立账号，客户只能看自己的货。</p></div></div>
        <div class="stack">
          <article class="card">
            <div class="card-head">
              <h3>客户列表</h3>
              <button class="btn primary compact" type="button" data-action="toggle-client-create">${state.showClientCreate ? "收起新增" : "新增客户"}</button>
            </div>
            ${state.showClientCreate ? `<div class="card-body">${adminClientForm()}</div>` : ""}
            <div class="card-body">${searchBox("clients", "搜索客户公司、联系人、账号")}</div>
            <div class="card-body">${adminClientList(searchedClients)}</div>
          </article>
        </div>
      </section>`,
    inventory: `
      <section class="section active">
        <div class="section-head"><div><h2>库存管理</h2><p>全仓商品是主视图，可在这里新增或删除商品。</p></div></div>
        <article class="card">
          <div class="card-head"><h3>全仓库存</h3>${inventoryToolbar()}</div>
          ${state.showProductCreate ? `<div class="card-body">${adminInventoryForm(data.clients)}</div>` : ""}
          <div class="card-body">${searchBox("inventory", "搜索客户、产品ID、SKU、货品")}</div>
          ${inventoryTable(searchedInventory, data.clients, { adminActions: true })}
        </article>
      </section>`,
    requests: `
      <section class="section active">
        <div class="section-head"><div><h2>申请处理</h2><p>审核入库、退仓和代发单。</p></div></div>
        <article class="card"><div class="card-body">${requestFilterBar()}</div><div class="card-body">${requestList(searchedRequests, true)}</div></article>
      </section>`,
    logs: `
      <section class="section active">
        <div class="section-head"><div><h2>日志记录</h2><p>系统自动记录商品和客户关键变更，日志不可编辑、不可删除。</p></div></div>
        <article class="card"><div class="card-head"><h3>查询条件</h3></div><div class="card-body">${logSearchForm()}</div></article>
        <article class="card"><div class="card-head"><h3>日志列表</h3></div><div class="card-body">${auditLogList(state.logs)}</div></article>
      </section>`
  };
  return `
    <div class="shell">
      ${topbar()}
      <div class="dashboard">
        ${nav([
          { id: "overview", label: "运营总览", glyph: "OP" },
          { id: "requests", label: "申请处理", glyph: "RQ" },
          { id: "inventory", label: "库存管理", glyph: "IN" },
          { id: "clients", label: "客户子账号", glyph: "AC" },
          { id: "logs", label: "日志记录", glyph: "LG" }
        ])}
        <div class="content">${sections[state.view] || sections.overview}</div>
      </div>
    </div>`;
}

function clientCards(clients) {
  if (!clients.length) return `<div class="empty">还没有客户账号。</div>`;
  return `<div class="request-list">${clients
    .map(
      (client) => `
      <article class="request-item">
        <header><div><h4>${h(client.company)}</h4><p>${h(client.name)} · ${h(client.username)}</p></div><span class="status done">${h(clientStatusLabel(client.status))}</span></header>
      </article>`
    )
    .join("")}</div>`;
}

function loginView() {
  return `
    <div class="login-wrap">
      <div class="login-panel">
        <section class="hero-copy brand-hero">
          <div class="brand-hero-inner">
            <h2 class="login-brand-title" aria-label="${APP_NAME}">${animatedBrandText()}</h2>
          </div>
        </section>
        <section class="glass-panel login-card">
          <div class="brand" style="margin-bottom: 28px">
            <div><h1>统一登录</h1></div>
          </div>
          <form class="form" data-form="login">
            <label>账号 <input class="input" name="username" autocomplete="username" placeholder="请输入账号" required /></label>
            <label>密码 <input class="input" name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required /></label>
            <button class="btn primary" type="submit">进入系统</button>
          </form>
          <p class="hint">默认管理员：admin / admin123<br />演示客户：client / client123</p>
        </section>
      </div>
    </div>`;
}

async function loadData() {
  if (!state.user) return;
  const path = state.user.role === "admin" ? "/api/admin/summary" : "/api/client/summary";
  state.data = await api(path);
  if (state.user.role === "admin" && state.view === "logs") {
    const params = new URLSearchParams(
      Object.entries(state.logFilters).filter(([, value]) => String(value || "").trim())
    );
    const payload = await api(`/api/admin/logs${params.toString() ? `?${params}` : ""}`);
    state.logs = payload.logs || [];
  }
}

async function render() {
  if (!state.token || !state.user) {
    app.innerHTML = loginView();
    bindEvents();
    return;
  }
  try {
    await loadData();
    app.innerHTML = state.user.role === "admin" ? adminDashboard() : clientDashboard();
    bindEvents();
  } catch (error) {
    clearSession();
    app.innerHTML = loginView();
    bindEvents();
    toast(error.message);
  }
}

function formPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function requireFormFields(payload, fields) {
  const labels = {
    label: "地址名称",
    receiver: "收件人",
    address: "详细地址",
    sku: "SKU",
    productName: "货品名称",
    username: "账号",
    password: "密码"
  };
  const missing = fields.filter((field) => !String(payload[field] || "").trim());
  if (missing.length) {
    toast(`请填写${missing.map((field) => labels[field] || field).join("、")}`);
    return false;
  }
  return true;
}

function confirmDeletion(label) {
  return prompt(`确认删除${label}？请输入“确认删除”后继续。`) === "确认删除";
}

function bindEvents() {
  app.querySelectorAll("button").forEach((button) => {
    button.addEventListener("pointerdown", addRipple);
  });

  app.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      state.editingClientId = "";
      render();
    });
  });

  app.querySelectorAll("[data-overview-size]").forEach((button) => {
    button.addEventListener("click", () => {
      const layout = clientOverviewLayout().map((module) =>
        module.id === button.dataset.moduleId ? { ...module, size: button.dataset.overviewSize } : module
      );
      saveClientOverviewLayout(layout);
      render();
    });
  });

  let draggedOverviewId = "";
  app.querySelectorAll("[data-overview-module]").forEach((module) => {
    module.addEventListener("dragstart", (event) => {
      draggedOverviewId = module.dataset.overviewModule;
      module.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedOverviewId);
    });
    module.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (module.dataset.overviewModule !== draggedOverviewId) module.classList.add("drag-over");
    });
    module.addEventListener("dragleave", () => module.classList.remove("drag-over"));
    module.addEventListener("drop", (event) => {
      event.preventDefault();
      const fromId = draggedOverviewId || event.dataTransfer.getData("text/plain");
      const toId = module.dataset.overviewModule;
      document.querySelectorAll(".overview-module").forEach((item) => item.classList.remove("drag-over", "dragging"));
      if (!fromId || !toId || fromId === toId) return;
      const layout = [...clientOverviewLayout()];
      const fromIndex = layout.findIndex((item) => item.id === fromId);
      const toIndex = layout.findIndex((item) => item.id === toId);
      if (fromIndex < 0 || toIndex < 0) return;
      const [moved] = layout.splice(fromIndex, 1);
      layout.splice(toIndex, 0, moved);
      saveClientOverviewLayout(layout);
      render();
    });
    module.addEventListener("dragend", () => {
      draggedOverviewId = "";
      document.querySelectorAll(".overview-module").forEach((item) => item.classList.remove("drag-over", "dragging"));
    });
  });

  app.querySelectorAll("[data-search]").forEach((input) => {
    input.addEventListener("input", () => {
      state.adminSearch[input.dataset.search] = input.value;
      render();
    });
  });

  app.querySelectorAll("[data-request-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.requestCategory = button.dataset.requestCategory;
      render();
    });
  });

  app.querySelector("[data-action='logout']")?.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    clearSession();
    render();
  });

  app.querySelector("[data-action='toggle-client-create']")?.addEventListener("click", () => {
    state.showClientCreate = !state.showClientCreate;
    state.editingClientId = "";
    render();
  });

  app.querySelectorAll("[data-action='edit-client']").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingClientId = state.editingClientId === button.dataset.clientId ? "" : button.dataset.clientId;
      state.showClientCreate = false;
      render();
    });
  });

  app.querySelectorAll("[data-action='delete-client']").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-client-id]");
      const name = row?.querySelector("h4")?.textContent || "该客户";
      if (!confirmDeletion(` ${name}`)) return;
      try {
        await api(`/api/admin/clients/${button.dataset.clientId}`, { method: "DELETE" });
        state.editingClientId = "";
        await render();
        toast("客户已删除");
      } catch (error) {
        toast(error.message);
      }
    });
  });

  app.querySelector("[data-action='cancel-client-edit']")?.addEventListener("click", () => {
    state.editingClientId = "";
    render();
  });

  app.querySelector("[data-action='toggle-product-create']")?.addEventListener("click", () => {
    state.showProductCreate = !state.showProductCreate;
    render();
  });

  app.querySelector("[data-action='toggle-client-product-create']")?.addEventListener("click", () => {
    state.showClientProductCreate = !state.showClientProductCreate;
    render();
  });

  app.querySelectorAll("[data-action='open-product-picker']").forEach((button) => {
    button.addEventListener("click", () => {
      state.productPicker = { open: true, type: button.dataset.requestType, query: "" };
      render();
    });
  });

  app.querySelectorAll("[data-action='close-product-picker']").forEach((button) => {
    button.addEventListener("click", () => {
      state.productPicker = { open: false, type: "", query: "" };
      render();
    });
  });

  app.querySelector("[data-action='clear-product-picker']")?.addEventListener("click", () => {
    if (state.productPicker.type) state.requestSelections[state.productPicker.type] = {};
    render();
  });

  app.querySelector("[data-product-picker-search]")?.addEventListener("input", (event) => {
    state.productPicker.query = event.currentTarget.value;
    const query = state.productPicker.query.trim().toLowerCase();
    app.querySelectorAll("[data-picker-row]").forEach((row) => {
      row.classList.toggle("hidden", query && !row.dataset.pickerRow.includes(query));
    });
  });

  app.querySelector("[data-address-library-search]")?.addEventListener("input", (event) => {
    state.addressSearch = event.currentTarget.value;
    const query = state.addressSearch.trim().toLowerCase();
    let visibleCount = 0;
    app.querySelectorAll("[data-address-library-row]").forEach((row) => {
      const visible = !query || row.dataset.addressLibraryRow.includes(query);
      row.classList.toggle("hidden", !visible);
      if (visible) visibleCount += 1;
    });
    app.querySelector("[data-address-library-empty]")?.classList.toggle("hidden", visibleCount !== 0);
  });

  app.querySelector("[data-product-search]")?.addEventListener("input", (event) => {
    state.productSearch = event.currentTarget.value;
    const query = state.productSearch.trim().toLowerCase();
    let visibleCount = 0;
    app.querySelectorAll("[data-product-row]").forEach((row) => {
      const visible = !query || row.dataset.productRow.includes(query);
      row.classList.toggle("hidden", !visible);
      if (visible) visibleCount += 1;
    });
    app.querySelector("[data-product-search-empty]")?.classList.toggle("hidden", visibleCount !== 0);
  });

  app.querySelectorAll("[data-picker-sku]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const type = state.productPicker.type;
      if (checkbox.checked) selectRequestProduct(type, checkbox.dataset.pickerSku);
      else unselectRequestProduct(type, checkbox.dataset.pickerSku);
    });
  });

  app.querySelectorAll("[data-action='open-address-picker']").forEach((button) => {
    button.addEventListener("click", () => {
      state.addressPicker = { open: true, formType: button.dataset.formType, query: "" };
      render();
    });
  });

  app.querySelectorAll("[data-action='close-address-picker']").forEach((button) => {
    button.addEventListener("click", () => {
      state.addressPicker = { open: false, formType: "", query: "" };
      render();
    });
  });

  app.querySelector("[data-address-picker-search]")?.addEventListener("input", (event) => {
    state.addressPicker.query = event.currentTarget.value;
    const query = state.addressPicker.query.trim().toLowerCase();
    let visibleCount = 0;
    app.querySelectorAll("[data-address-picker-row]").forEach((row) => {
      const visible = !query || row.dataset.addressPickerRow.includes(query);
      row.classList.toggle("hidden", !visible);
      if (visible) visibleCount += 1;
    });
    app.querySelector("[data-address-picker-empty]")?.classList.toggle("hidden", visibleCount !== 0);
  });

  app.querySelectorAll("[data-action='select-address']").forEach((button) => {
    button.addEventListener("click", async () => {
      const address = (state.data?.addresses || []).find((item) => item.id === button.dataset.addressId);
      if (!address) {
        toast("地址不存在");
        return;
      }
      state.addressPicker = { open: false, formType: "", query: "" };
      await render();
      const form = app.querySelector(`[data-form='client-request'] input[name='type'][value='${state.view}']`)?.closest("form");
      if (!form) return;
      form.elements.receiver.value = address.receiver || "";
      form.elements.phone.value = address.phone || "";
      form.elements.address.value = address.address || "";
      toast("地址已带入");
    });
  });

  app.querySelector("[data-form='client-address']")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = formPayload(form);
    try {
      await api("/api/client/addresses", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      await render();
      toast("地址已新增");
    } catch (error) {
      toast(error.message);
    }
  });

  app.querySelectorAll("[data-form='client-address-edit']").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = formPayload(form);
      try {
        await api(`/api/client/addresses/${form.dataset.addressId}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        state.editingAddressId = "";
        await render();
        toast("地址已保存");
      } catch (error) {
        toast(error.message);
      }
    });
  });

  app.querySelectorAll("[data-action='edit-address']").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingAddressId = state.editingAddressId === button.dataset.addressId ? "" : button.dataset.addressId;
      render();
    });
  });

  app.querySelector("[data-action='cancel-address-edit']")?.addEventListener("click", () => {
    state.editingAddressId = "";
    render();
  });

  app.querySelectorAll("[data-action='delete-address']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirmDeletion(`地址 ${button.dataset.addressLabel}`)) return;
      try {
        await api(`/api/client/addresses/${button.dataset.addressId}`, { method: "DELETE" });
        state.editingAddressId = "";
        await render();
        toast("地址已删除");
      } catch (error) {
        toast(error.message);
      }
    });
  });

  app.querySelectorAll("[data-action='product-row-request']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.dataset.status === "frozen") {
        toast("冻结商品暂时不能创建申请");
        return;
      }
      selectRequestProduct(button.dataset.requestType, button.dataset.sku);
      state.view = button.dataset.requestType;
      await render();
      toast("已带入商品，请填写数量后提交");
    });
  });

  app.querySelectorAll("[data-product-batch-sku]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedProductSkus[checkbox.dataset.productBatchSku] = true;
      else delete state.selectedProductSkus[checkbox.dataset.productBatchSku];
      render();
    });
  });

  app.querySelector("[data-action='toggle-all-products']")?.addEventListener("change", (event) => {
    if (event.currentTarget.checked) {
      state.selectedProductSkus = Object.fromEntries(normalInventoryItems().map((item) => [item.sku, true]));
    } else {
      state.selectedProductSkus = {};
    }
    render();
  });

  app.querySelector("[data-action='clear-product-batch']")?.addEventListener("click", () => {
    state.selectedProductSkus = {};
    render();
  });

  app.querySelectorAll("[data-action='batch-product-request']").forEach((button) => {
    button.addEventListener("click", async () => {
      const type = button.dataset.requestType;
      const selected = selectedProductSkus();
      if (!selected.length) {
        toast("请先选择商品");
        return;
      }
      const normalSkus = new Set(normalInventoryItems().map((item) => item.sku));
      state.requestSelections[type] = {};
      for (const sku of selected) {
        if (normalSkus.has(sku)) selectRequestProduct(type, sku);
      }
      if (!selectedSkus(type).length) {
        toast("冻结商品暂时不能创建申请");
        return;
      }
      state.view = type;
      await render();
      toast(type === "dropship" ? "已带入商品。代发订单只填写一个收件人，所有选中商品共用该收件信息。" : "已带入商品，请分别填写数量后提交");
    });
  });

  app.querySelectorAll("[data-action='request-product-delete']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (Number(button.dataset.quantity || 0) !== 0) {
        toast("库存为 0 时才可以申请删除商品");
        return;
      }
      if (!confirmDeletion(`商品 ${button.dataset.sku}`)) return;
      try {
        await api("/api/client/requests", {
          method: "POST",
          body: JSON.stringify({
            type: "product_delete",
            sku: button.dataset.sku,
            productName: button.dataset.name,
            note: "客户申请删除库存为 0 的商品"
          })
        });
        await render();
        toast("删除申请已提交，等待管理员审批");
      } catch (error) {
        toast(error.message);
      }
    });
  });

  app.querySelectorAll("[data-action='delete-product']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirmDeletion("这个商品")) return;
      try {
        await api(`/api/admin/inventory/${button.dataset.productId}`, { method: "DELETE" });
        await render();
        toast("商品已删除");
      } catch (error) {
        toast(error.message);
      }
    });
  });

  app.querySelectorAll("[data-action='toggle-product-status']").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/admin/inventory/${button.dataset.productId}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: button.dataset.status })
        });
        await render();
        toast(button.dataset.status === "normal" ? "商品已恢复正常" : "商品已冻结");
      } catch (error) {
        toast(error.message);
      }
    });
  });

  app.querySelector("[data-form='login']")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = await api("/api/login", {
        method: "POST",
        body: JSON.stringify(formPayload(event.currentTarget))
      });
      saveSession(payload.token, payload.user);
      state.view = "overview";
      await render();
      toast("登录成功");
    } catch (error) {
      toast(error.message);
    }
  });

  app.querySelector("[data-form='client-request']")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = formPayload(form);
    try {
      if (payload.type === "product_create") {
        await api("/api/client/requests", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      } else {
        const selected = selectedSkus(payload.type);
        if (!selected.length) {
          toast("请先选择商品");
          return;
        }
        const inventory = state.data?.inventory || [];
        const formData = new FormData(form);
        for (const sku of selected) {
          const product = inventory.find((item) => item.sku === sku);
          const quantity = Math.max(1, Number(formData.get(`quantity:${sku}`) || requestSelection(payload.type)[sku] || 1));
          await api("/api/client/requests", {
            method: "POST",
            body: JSON.stringify({
              ...payload,
              sku,
              productName: product?.name || sku,
              quantity
            })
          });
        }
        state.requestSelections[payload.type] = {};
      }
      form.reset();
      await render();
      toast("申请已提交");
    } catch (error) {
      toast(error.message);
    }
  });

  app.querySelector("[data-form='admin-client']")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/api/admin/clients", {
        method: "POST",
        body: JSON.stringify(formPayload(form))
      });
      form.reset();
      state.showClientCreate = false;
      await render();
      toast("子账号已创建");
    } catch (error) {
      toast(error.message);
    }
  });

  app.querySelectorAll("[data-form='admin-client-edit']").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api(`/api/admin/clients/${form.dataset.clientId}`, {
          method: "PATCH",
          body: JSON.stringify(formPayload(form))
        });
        state.editingClientId = "";
        await render();
        toast("客户信息已更新");
      } catch (error) {
        toast(error.message);
      }
    });
  });

  app.querySelector("[data-form='admin-log-filter']")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.logFilters = { query: "", from: "", to: "", role: "", ...formPayload(event.currentTarget) };
    await render();
  });

  app.querySelector("[data-form='admin-inventory']")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/api/admin/inventory", {
        method: "POST",
        body: JSON.stringify(formPayload(form))
      });
      form.reset();
      await render();
      toast("库存已更新");
    } catch (error) {
      toast(error.message);
    }
  });

  app.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.closest("[data-request-id]").dataset.requestId;
      try {
        await api(`/api/admin/requests/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: button.dataset.status })
        });
        await render();
        toast("状态已更新");
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

render();
