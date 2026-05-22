const app = document.querySelector("#app");
const APP_NAME = "(주)보쥬";

const state = {
  token: localStorage.getItem("wms.token") || "",
  user: JSON.parse(localStorage.getItem("wms.user") || "null"),
  data: null,
  view: "overview"
};

const statusMap = {
  pending: "待处理",
  approved: "已通过",
  processing: "处理中",
  done: "已完成",
  rejected: "已驳回"
};

const typeMap = {
  inbound: "入库",
  return: "退仓",
  dropship: "代发"
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

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "请求失败");
  return payload;
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
  localStorage.removeItem("wms.token");
  localStorage.removeItem("wms.user");
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

function inventoryTable(inventory, clients = []) {
  if (!inventory.length) return `<div class="empty">这里暂时没有库存。</div>`;
  const clientName = (id) => clients.find((client) => client.id === id)?.company || id;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${clients.length ? "<th>客户</th>" : ""}
            <th>SKU</th><th>货品</th><th>库位</th><th>库存</th><th>锁定</th><th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          ${inventory
            .map(
              (item) => `
              <tr>
                ${clients.length ? `<td>${h(clientName(item.ownerId))}</td>` : ""}
                <td class="sku">${h(item.sku)}</td>
                <td>${h(item.name)}</td>
                <td>${h(item.location || "待上架")}</td>
                <td>${Number(item.quantity || 0)}</td>
                <td>${Number(item.locked || 0)}</td>
                <td>${fmtDate(item.updatedAt)}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
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
            <h4>${h(item.title)}</h4>
            <p>${admin ? h(item.owner?.company || "") + " · " : ""}${h(item.sku)} · ${fmtDate(item.createdAt)}</p>
          </div>
          ${statusBadge(item.status)}
        </header>
        <p>${typeMap[item.type] || item.type} / 数量 ${Number(item.quantity || 0)}${item.receiver ? ` / 收件人 ${h(item.receiver)}` : ""}</p>
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

function clientRequestForm() {
  return `
    <form class="form" data-form="client-request">
      <label>申请类型
        <select class="select" name="type">
          <option value="inbound">申请入库</option>
          <option value="return">申请退仓</option>
          <option value="dropship">申请代发</option>
        </select>
      </label>
      <label>SKU <input class="input" name="sku" placeholder="例如 AURORA-CASE-01" required /></label>
      <label>货品名称 <input class="input" name="productName" placeholder="例如 磁吸手机壳" required /></label>
      <label>数量 <input class="input" name="quantity" type="number" min="1" value="1" required /></label>
      <label>物流单号 <input class="input" name="trackingNo" placeholder="入库时填写更方便" /></label>
      <label>收件人 <input class="input" name="receiver" placeholder="退仓或代发时填写" /></label>
      <label>收件地址 <textarea class="textarea" name="address" placeholder="退仓或代发地址"></textarea></label>
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

function clientDashboard() {
  const data = state.data;
  const sections = {
    overview: `
      <section class="section active">
        <div class="section-head"><div><h2>仓库概览</h2><p>你的库存、锁定数量和最近申请都在这里。</p></div></div>
        ${statCards(data.stats, "client")}
        <div class="grid-2">
          <article class="card"><div class="card-head"><h3>我的库存</h3></div>${inventoryTable(data.inventory)}</article>
          <article class="card"><div class="card-head"><h3>最近申请</h3></div><div class="card-body">${requestList(data.requests.slice(0, 5))}</div></article>
        </div>
      </section>`,
    requests: `
      <section class="section active">
        <div class="section-head"><div><h2>申请中心</h2><p>入库、退仓、代发都从这里提交。</p></div></div>
        <div class="grid-2">
          <article class="card"><div class="card-head"><h3>新申请</h3></div><div class="card-body">${clientRequestForm()}</div></article>
          <article class="card"><div class="card-head"><h3>申请记录</h3></div><div class="card-body">${requestList(data.requests)}</div></article>
        </div>
      </section>`,
    inventory: `
      <section class="section active">
        <div class="section-head"><div><h2>库存明细</h2><p>客户只能看到自己名下的货。</p></div></div>
        <article class="card">${inventoryTable(data.inventory)}</article>
      </section>`
  };
  return `
    <div class="shell">
      ${topbar()}
      <div class="dashboard">
        ${nav([
          { id: "overview", label: "仓库概览", glyph: "OV" },
          { id: "requests", label: "申请中心", glyph: "RQ" },
          { id: "inventory", label: "库存明细", glyph: "SK" }
        ])}
        <div class="content">${sections[state.view] || sections.overview}</div>
      </div>
    </div>`;
}

function adminDashboard() {
  const data = state.data;
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
          <article class="card"><div class="card-head"><h3>子账号</h3></div><div class="card-body">${clientCards(data.clients)}</div></article>
        </div>
      </section>`,
    clients: `
      <section class="section active">
        <div class="section-head"><div><h2>客户子账号</h2><p>为每个客户分配独立账号，客户只能看自己的货。</p></div></div>
        <div class="grid-2">
          <article class="card"><div class="card-head"><h3>新增客户</h3></div><div class="card-body">${adminClientForm()}</div></article>
          <article class="card"><div class="card-head"><h3>客户列表</h3></div><div class="card-body">${clientCards(data.clients)}</div></article>
        </div>
      </section>`,
    inventory: `
      <section class="section active">
        <div class="section-head"><div><h2>库存管理</h2><p>按客户入账、修正数量和库位。</p></div></div>
        <div class="grid-2">
          <article class="card"><div class="card-head"><h3>库存入账</h3></div><div class="card-body">${adminInventoryForm(data.clients)}</div></article>
          <article class="card"><div class="card-head"><h3>全仓库存</h3></div>${inventoryTable(data.inventory, data.clients)}</article>
        </div>
      </section>`,
    requests: `
      <section class="section active">
        <div class="section-head"><div><h2>申请处理</h2><p>审核入库、退仓和代发单。</p></div></div>
        <article class="card"><div class="card-body">${requestList(data.requests, true)}</div></article>
      </section>`
  };
  return `
    <div class="shell">
      ${topbar()}
      <div class="dashboard">
        ${nav([
          { id: "overview", label: "运营总览", glyph: "OP" },
          { id: "clients", label: "客户子账号", glyph: "AC" },
          { id: "inventory", label: "库存管理", glyph: "IN" },
          { id: "requests", label: "申请处理", glyph: "RQ" }
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
        <header><div><h4>${h(client.company)}</h4><p>${h(client.name)} · ${h(client.username)}</p></div><span class="status done">${h(client.status)}</span></header>
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

function bindEvents() {
  app.querySelectorAll("button").forEach((button) => {
    button.addEventListener("pointerdown", addRipple);
  });

  app.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      render();
    });
  });

  app.querySelector("[data-action='logout']")?.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    clearSession();
    render();
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
    try {
      await api("/api/client/requests", {
        method: "POST",
        body: JSON.stringify(formPayload(form))
      });
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
      await render();
      toast("子账号已创建");
    } catch (error) {
      toast(error.message);
    }
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
