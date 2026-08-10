let user = null, authType = "login";

const money = n => Number(n).toLocaleString("vi-VN") + "đ";

async function api(url, opt = {}) {
  let r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opt
  });

  let d = await r.json().catch(() => ({}));

  if (!r.ok) throw new Error(d.error || "Có lỗi xảy ra");

  return d;
}

function toast(t) {
  let e = document.getElementById("toast");
  e.textContent = t;
  e.classList.add("show");

  clearTimeout(window.tt);

  window.tt = setTimeout(() => {
    e.classList.remove("show");
  }, 2200);
}

function openModal(id) {
  document.getElementById(id).style.display = "flex";
}

function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

function openAuth() {
  openModal("auth");
}

function openDeposit() {
  if (!user) return openAuth();
  openModal("deposit");
}

function setAmount(n) {
  document.getElementById("amount").value = n;
}

function authMode(m) {
  authType = m;

  document.getElementById("name").style.display =
    m === "register" ? "block" : "none";

  document.getElementById("loginTab").classList.toggle(
    "active",
    m === "login"
  );

  document.getElementById("regTab").classList.toggle(
    "active",
    m === "register"
  );
}

async function submitAuth() {
  try {
    const nameEl = document.getElementById("name");
    const emailEl = document.getElementById("email");
    const passEl = document.getElementById("pass");

    const body = {
      email: emailEl.value.trim(),
      password: passEl.value
    };

    if (authType === "register") {
      body.name = nameEl.value.trim();
    }

    let d = await api("/api/" + authType, {
      method: "POST",
      body: JSON.stringify(body)
    });

    user = d.user;

    closeModal("auth");
    renderUser();
    loadAll();

    toast(
      authType === "login"
        ? "Đăng nhập thành công"
        : "Tạo tài khoản thành công"
    );
  } catch (e) {
    document.getElementById("authMsg").textContent = e.message;
  }
}

function renderUser() {
  document.getElementById("userArea").innerHTML = user
    ? `<button onclick="logout()">${user.name} · ${money(user.balance)}</button>${
        user.role === "admin" ? " Admin" : ""
      }`
    : `<button onclick="openAuth()">Đăng nhập</button>`;

  document.getElementById("bal").textContent =
    money(user?.balance || 0);

  document.getElementById("heroBal").textContent =
    money(user?.balance || 0);
}

async function logout() {
  await api("/api/logout", { method: "POST" });

  user = null;
  renderUser();

  toast("Đã đăng xuất");
}

async function loadServices() {
  let s = await api("/api/services");

  window.services = s;

  renderServices();
}

function renderServices() {
  let q = (
    document.getElementById("q").value || ""
  ).toLowerCase();

  let a = (window.services || []).filter(x =>
    (x.name + x.category + x.description)
      .toLowerCase()
      .includes(q)
  );

  document.getElementById("services").innerHTML =
    a.map(x => `
      <article class="card">

        <img
          class="service-img"
          src="${
            x.category === "TikTok"
              ? "https://placehold.co/800x450/111827/ffffff?text=TikTok"
              : x.category === "Facebook"
              ? "https://placehold.co/800x450/111827/ffffff?text=Facebook"
              : "https://placehold.co/800x450/111827/ffffff?text=Zalo"
          }"
          alt="${x.category}"
        >

        <span class="tag">${x.category.toUpperCase()}</span>

        <h3>${x.name}</h3>

        <p>${x.description}</p>

        <div class="price">${money(x.price)}</div>

        <button class="buy" onclick="buy(${x.id})">
          Mua dịch vụ →
        </button>

      </article>
    `).join("") || "Không có dịch vụ phù hợp.";
}

async function buy(id) {
  try {
    let d = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        serviceId: id
      })
    });

    user = d.user;

    renderUser();
    loadOrders();

    toast("Đã tạo đơn #" + d.orderId);
  } catch (e) {
    toast(e.message);

    if (e.message.includes("Số dư")) {
      openDeposit();
    }
  }
}

async function loadOrders() {
  if (!user) {
    document.getElementById("orderList").innerHTML =
      "Đăng nhập để xem đơn hàng.";
    return;
  }

  let a = await api("/api/orders");

  document.getElementById("orderList").innerHTML =
    a.length
      ? a.map(o => `
          <div class="row">
            <div>
              <strong>#${o.id} · ${o.service}</strong>
              <br>
              <small>${o.createdAt}</small>
            </div>

            <div>
              <b>${money(o.price)}</b>
              <br>
              <span class="${o.status === "completed" ? "ok" : ""}">
                ${o.status}
              </span>
            </div>
          </div>
        `).join("")
      : "Chưa có đơn hàng.";
}

async function createDeposit() {
  try {
    let amount = Number(
      document.getElementById("amount").value
    );

    let d = await api("/api/deposits", {
      method: "POST",
      body: JSON.stringify({
        amount
      })
    });

    let cfg = await api("/api/config");

    let qr = document.getElementById("qr");

    if (cfg.bankConfigured) {
      let q = await api(
        "/api/qr/" +
          amount +
          "/" +
          encodeURIComponent(d.transferCode)
      );

      qr.innerHTML = `
        <img src="${q.qrUrl}" alt="VietQR">
        <p><b>${q.accountName}</b> · ${q.accountNo}</p>
        <p>Mã chuyển khoản: <b>${d.transferCode}</b></p>
      `;
    } else {
      qr.innerHTML = `
        <p style="color:#ffcf6b">
          QR chưa hiển thị vì admin chưa cấu hình ngân hàng.
        </p>

        <p>
          Mã chuyển khoản:
          <b>${d.transferCode}</b>
        </p>
      `;
    }

    toast("Đã tạo yêu cầu nạp");
  } catch (e) {
    toast(e.message);
  }
}

async function openAdmin() {
  openModal("admin");

  try {
    let [s, d, o, u] = await Promise.all([
      api("/api/admin/summary"),
      api("/api/admin/deposits"),
      api("/api/admin/orders"),
      api("/api/admin/users")
    ]);

    document.getElementById("adminContent").innerHTML = `
      <div class="grid">

        <div class="card">
          Users
          <h2>${s.users}</h2>
        </div>

        <div class="card">
          Nạp chờ duyệt
          <h2>${s.pendingDeposits}</h2>
        </div>

        <div class="card">
          Đơn chờ xử lý
          <h2>${s.pendingOrders}</h2>
        </div>

      </div>

      <h3>Giao dịch nạp</h3>

      <table class="adminTable">
        <tr>
          <th>Khách</th>
          <th>Số tiền</th>
          <th>Mã</th>
          <th>Trạng thái</th>
          <th></th>
        </tr>

        ${d.map(x => `
          <tr>
            <td>${x.name}<br>${x.email}</td>
            <td>${money(x.amount)}</td>
            <td>${x.transferCode}</td>
            <td>${x.status}</td>
            <td>
              ${
                x.status === "pending"
                  ? `
                    <button onclick="approve(${x.id})">
                      Duyệt
                    </button>

                    <button onclick="reject(${x.id})">
                      Từ chối
                    </button>
                  `
                  : ""
              }
            </td>
          </tr>
        `).join("")}
      </table>

      <h3>Đơn hàng</h3>

      <table class="adminTable">
        <tr>
          <th>#</th>
          <th>Khách</th>
          <th>Dịch vụ</th>
          <th>Giá</th>
          <th>Trạng thái</th>
        </tr>

        ${o.map(x => `
          <tr>
            <td>${x.id}</td>
            <td>${x.name}</td>
            <td>${x.service}</td>
            <td>${money(x.price)}</td>
            <td>${x.status}</td>
          </tr>
        `).join("")}
      </table>
    `;
  } catch (e) {
    toast(e.message);
  }
}

async function approve(id) {
  try {
    await api("/api/admin/deposits/" + id + "/approve", {
      method: "POST"
    });

    toast("Đã duyệt");
    openAdmin();
  } catch (e) {
    toast(e.message);
  }
}

async function reject(id) {
  try {
    await api("/api/admin/deposits/" + id + "/reject", {
      method: "POST"
    });

    toast("Đã từ chối");
    openAdmin();
  } catch (e) {
    toast(e.message);
  }
}

async function loadAll() {
  await loadServices();
  await loadOrders();
}

authMode("login");
renderUser();
loadAll();
