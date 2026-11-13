// ─── Data ───
const orders = window.ordersData || [];


// Canvas state



let currentCanvasOrder = null;
let mockupGenerated = false;
let designMode = "ai"; // "ai" = fields optional, AI fills gaps | "manual" = all fields required

const AUTO_FABRICS = ["Polyester", "Cotton Blend", "Mesh"];
const AUTO_COLORS = ["#FFFFFF", "#2B2620", "#A33B3B", "#2F6F63", "#6B8E4E", "#C1652C", "#6B4A6B", "#C1652C"];
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function switchDesignMode(mode) {
  designMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

  const tags = ["tagFabric", "tagPrimaryColor", "tagSecondaryColor"];
  tags.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = mode === "manual" ? "Required" : "Optional";
    el.classList.toggle("required", mode === "manual");
    el.classList.toggle("optional", mode === "ai");
  });

  const hintEl = document.getElementById("modeHint");
  if (hintEl) {
    hintEl.textContent = mode === "manual"
      ? "Manual mode: set fabric, colors and pattern yourself — the AI will render your exact spec."
      : "In AI mode, colors, fabric & pattern are optional — leave on \"Auto\" and the AI will choose. Switch to Manual to set every field yourself.";
  }

  document.querySelectorAll('.fabric-cards .fabric-card[data-fabric="auto"]').forEach(el => el.style.display = mode === "manual" ? "none" : "");
  document.querySelectorAll('.color-picker .auto-swatch').forEach(el => el.style.display = mode === "manual" ? "none" : "");

  // If switching to manual and an "auto" is currently selected, clear it so the user must pick
  if (mode === "manual") {
    const fabricSel = document.querySelector('.fabric-card.selected');
    if (fabricSel && fabricSel.dataset.fabric === "auto") fabricSel.classList.remove("selected");
    document.querySelectorAll('.color-picker').forEach(p => {
      const sel = p.querySelector('.color-option.selected');
      if (sel && sel.dataset.color === "auto") sel.classList.remove("selected");
    });
  } else {
    // Switching back to AI: default back to Auto for anything unset
    if (!document.querySelector('.fabric-card.selected')) {
      const el = document.querySelector('.fabric-card[data-fabric="auto"]');
      if (el) el.classList.add("selected");
    }
    document.querySelectorAll('.color-picker').forEach(p => {
      if (!p.querySelector('.color-option.selected')) {
        const el = p.querySelector('.auto-swatch');
        if (el) el.classList.add("selected");
      }
    });
  }
  // calcSuggestedPrice() removed
}

const now = new Date("2026-07-22T12:00:00Z");

// ─── Helpers ───
function getCSRFToken() {
  const name = 'csrftoken';
  const cookies = document.cookie.split(';');
  for (let c of cookies) {
    c = c.trim();
    if (c.startsWith(name + '=')) return c.substring(name.length + 1);
  }
  return '';
}
function formatCurrency(v) { return "₹" + Math.round(v).toLocaleString("en-IN"); }
function getStatusLabel(s) {
  const map = { new: "New", design_in_progress: "In Design", awaiting_approval: "Awaiting Approval", declined: "Declined", qty_pending: "Qty Pending", in_production: "In Production", qc: "Quality Check", ready_for_payment: "Ready for Payment", paid: "Paid", shipped: "Shipped", pending_client_approval: "Pending Client", accepted: "Accepted", rejected: "Rejected" };
  return map[s] || s;
}
function getStatusBadge(s) {
  const cls = { new: "badge-blue", design_in_progress: "badge-orange", awaiting_approval: "badge-purple", declined: "badge-red", qty_pending: "badge-gray", in_production: "badge-blue", qc: "badge-orange", ready_for_payment: "badge-green", paid: "badge-green", shipped: "badge-green", pending_client_approval: "badge-purple", accepted: "badge-green", rejected: "badge-red" };
  return `<span class="badge ${cls[s] || 'badge-gray'}">${getStatusLabel(s)}</span>`;
}
function timeAgo(dateStr) {
  const diff = now - new Date(dateStr);
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(hrs / 24) + "d ago";
}

// ─── Section Navigation ───
function showSection(section) {
  document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
  document.getElementById('section-' + section).classList.add('active');
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => el.classList.remove('active'));
  event.currentTarget.classList.add('active');

  if (section === 'charts') renderCharts();
  if (section === 'canvas') populateCanvasOrderSelect();
}

// ─── KPIs ───
function renderKPIs() {
  if (!document.getElementById("kpiRow")) return;
  const total = orders.length;
  const createdToday = 0; // Placeholder
  const pendingApproval = orders.filter(o => o.status === "awaiting_approval").length;
  const approved = orders.filter(o => ["qty_pending", "in_production", "qc", "ready_for_payment", "paid", "shipped"].includes(o.status)).length;
  const sentToProduction = 0; // Placeholder
  const inProduction = orders.filter(o => o.status === "in_production").length;
  const completed = orders.filter(o => ["shipped"].includes(o.status)).length;

  document.getElementById("kpiRow").innerHTML = `
    <div class="kpi-card"><div class="info"><div class="label">Total Designs</div><div class="value">${total}</div></div></div>
    <div class="kpi-card"><div class="info"><div class="label">Created Today</div><div class="value">${createdToday}</div></div></div>
    <div class="kpi-card"><div class="info"><div class="label">Pending Approval</div><div class="value">${pendingApproval}</div></div></div>
    <div class="kpi-card"><div class="info"><div class="label">Approved Designs</div><div class="value">${approved}</div></div></div>
    <div class="kpi-card"><div class="info"><div class="label">Sent to Prod</div><div class="value">${sentToProduction}</div></div></div>
    <div class="kpi-card"><div class="info"><div class="label">In Production</div><div class="value">${inProduction}</div></div></div>
    <div class="kpi-card"><div class="info"><div class="label">Completed</div><div class="value">${completed}</div></div></div>
  `;
}

// ─── Dashboard Queue ───
function renderDashboardQueue() {
  if (!document.getElementById("dashboardQueueBody")) return;
  const designerStatuses = ["new", "design_in_progress"];
  const filtered = orders.filter(o => designerStatuses.includes(o.status)).slice(0, 5);
  const tbody = document.getElementById("dashboardQueueBody");
  tbody.innerHTML = filtered.map(o => {
    let logoHtml = o.designAssets?.logoUrl ? `<img src="${o.designAssets.logoUrl}" style="width:32px;height:32px;border-radius:4px;object-fit:cover;border:1px solid #E8E1D6;" title="Logo">` : '<span style="font-size:11px;color:#A33B3B;">No Logo</span>';
    let designHtml = o.designPreviewUrl ? `<img src="${o.designPreviewUrl}" style="width:32px;height:32px;border-radius:4px;object-fit:cover;border:1px solid #E8E1D6;margin-left:4px;" title="Design">` : '<span style="font-size:11px;color:#A33B3B;margin-left:4px;">No Design</span>';
    let assetsHtml = `<div style="display:flex;align-items:center;">${logoHtml}${designHtml}</div>`;
    let detailsHtml = `<div style="font-size:12px;font-weight:600;">Qty: ${o.quantity || '-'}</div><div style="font-size:11px;color:#7A7267;">${o.designAssets?.nameNumber || '-'}</div>`;
    return `
      <tr onclick="openOrderInCanvas('${o.id}')">
        <td><strong>${o.id}</strong></td>
        <td>${assetsHtml}</td>
        <td>${o.clientName}</td>
        <td>${o.jerseyType}</td>
        <td>${detailsHtml}</td>
        <td>${getStatusBadge(o.status)}</td>
        <td style="text-align:right;"><button class="btn btn-sm btn-primary" onclick="event.stopPropagation();openOrderInCanvas('${o.id}')">Design</button></td>
      </tr>
    `;
  }).join("");
}

// ─── Queue Table ───
let searchTerm = "";
function filterQueue() {
  searchTerm = document.getElementById("globalSearch")?.value?.toLowerCase() || '';
  renderQueue();
}
function renderQueue() {
  if (!document.getElementById("queueTableBody")) return;
  const designerStatuses = ["new", "design_in_progress"];
  let filtered = orders.filter(o => designerStatuses.includes(o.status));
  if (searchTerm) {
    filtered = filtered.filter(o => o.id.toLowerCase().includes(searchTerm) || o.clientName.toLowerCase().includes(searchTerm));
  }
  filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  document.getElementById("queueCount").textContent = filtered.length + " orders";
  const tbody = document.getElementById("queueTableBody");
  tbody.innerHTML = filtered.map(o => {
    let detailsHtml = `<div style="font-size:12px;font-weight:600;">Size: ${o.prelimSize || '-'} | Qty: ${o.quantity || '-'}</div><div style="font-size:11px;color:#7A7267;">${o.designAssets?.nameNumber || '-'}</div>`;
    let logoHtml = o.designAssets?.logoUrl ? `<img src="${o.designAssets.logoUrl}" style="width:32px;height:32px;border-radius:4px;object-fit:cover;border:1px solid #E8E1D6;" title="Logo">` : '<span style="font-size:11px;color:#A33B3B;">No Logo</span>';
    let designHtml = o.designPreviewUrl ? `<img src="${o.designPreviewUrl}" style="width:32px;height:32px;border-radius:4px;object-fit:cover;border:1px solid #E8E1D6;margin-left:4px;" title="Design">` : '<span style="font-size:11px;color:#A33B3B;margin-left:4px;">No Design</span>';
    let assetsHtml = `<div style="display:flex;align-items:center;">${logoHtml}${designHtml}</div>`;
    return `
      <tr onclick="openOrderInCanvas('${o.id}')">
        <td><strong>${o.id}</strong></td>
        <td>${assetsHtml}</td>
        <td>${o.clientName}</td>
        <td>${o.jerseyType}</td>
        <td>${detailsHtml}</td>
        <td style="text-align:right;"><button class="btn btn-sm btn-primary" onclick="event.stopPropagation();openOrderInCanvas('${o.id}')">Design</button></td>
      </tr>
    `;
  }).join("");
}

// ─── History ───
function renderHistory() {
  if (!document.getElementById("historyTableBody")) return;
  const historyStatuses = ["pending_client_approval", "rejected", "accepted", "qty_pending", "in_production", "qc", "ready_for_payment", "paid", "shipped", "declined", "awaiting_approval"];
  const filtered = orders.filter(o => historyStatuses.includes(o.status));
  document.getElementById("historyCount").textContent = filtered.length + " designs";
  const tbody = document.getElementById("historyTableBody");
  tbody.innerHTML = filtered.map(o => {
    
    let mockupImg = o.mockupUrl ? `<img src="${o.mockupUrl}" onclick="openFullscreen(this.src)" style="width:32px;height:32px;border-radius:4px;object-fit:cover;border:1px solid #E8E1D6;cursor:zoom-in;" title="3D Mockup">` : '';
    let cutoutImg = o.cutoutUrl ? `<img src="${o.cutoutUrl}" onclick="openFullscreen(this.src)" style="width:32px;height:32px;border-radius:4px;object-fit:cover;border:1px solid #E8E1D6;margin-left:4px;cursor:zoom-in;" title="Cutout">` : '';
    let oldLogo = o.designAssets?.logoUrl ? `<img src="${o.designAssets.logoUrl}" onclick="openFullscreen(this.src)" style="width:32px;height:32px;border-radius:4px;object-fit:cover;border:1px solid #E8E1D6;cursor:zoom-in;" title="Logo">` : '<span style="font-size:11px;color:#A33B3B;">No Logo</span>';
    
    let assetsHtml = (o.mockupUrl || o.cutoutUrl) 
      ? `<div style="display:flex;align-items:center;">${mockupImg}${cutoutImg}</div>`
      : oldLogo;

    return `
      <tr>
        <td><strong>${o.id}</strong></td>
        <td>${assetsHtml}</td>
        <td>${o.clientName}</td>
        <td>${o.jerseyType}</td>
        <td>${o.unitPrice > 0 ? formatCurrency(o.unitPrice) : '—'}</td>
        <td>${o.quantity || '—'}</td>
        <td>${o.totalCost > 0 ? formatCurrency(o.totalCost) : '—'}</td>
        <td>${getStatusBadge(o.status)}</td>
      </tr>`;
  }).join("");
}

window.simulateClientAction = function(id, newStatus) {
  const o = orders.find(x => x.id === id);
  if (o) {
    o.status = newStatus;
    o.history.push({ step: "Client " + newStatus, at: new Date().toISOString() });
    showToast("Simulated client " + newStatus + " for " + id);
    renderAll();
  }
}

window.sendToDesigner = function(id) {
  const o = orders.find(x => x.id === id);
  if (o) {
    o.status = "in_production";
    o.history.push({ step: "Sent to Designer", at: new Date().toISOString() });
    showToast(id + " sent to designer!");
    renderAll();
  }
}

// ─── Design Canvas ───
function openOrderInCanvas(id) {
  window.location.href = "/designer_dashboard/canvas.html?order_id=" + id;
}

// ─── Charts ───
let doughnutChart, barChart, lineChart, typeChart;

function renderCharts() {
  // Status Doughnut
  const statusCounts = { new: 0, design_in_progress: 0, awaiting_approval: 0, declined: 0 };
  orders.forEach(o => { if (statusCounts.hasOwnProperty(o.status)) statusCounts[o.status]++; });

  const ctx1 = document.getElementById("statusDoughnut");
  if (ctx1) {
    if (doughnutChart) doughnutChart.destroy();
    doughnutChart = new Chart(ctx1, {
      type: 'doughnut',
      data: {
        labels: ["New", "In Design", "Awaiting Approval", "Declined"],
        datasets: [{ data: Object.values(statusCounts), backgroundColor: ["#2F6F63", "#C1652C", "#6B4A6B", "#A33B3B"], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } } }, cutout: '65%' }
    });
  }

  // Designs per day (last 7 days)
  const ctx2 = document.getElementById("designsBarChart");
  if (ctx2) {
    const days = [];
    const designsPerDay = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
      const count = orders.filter(o => {
        const oDate = new Date(o.createdAt);
        return oDate.getDate() === d.getDate() && oDate.getMonth() === d.getMonth() && oDate.getFullYear() === d.getFullYear();
      }).length;
      designsPerDay.push(count);
    }

    if (barChart) barChart.destroy();
    barChart = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: days,
        datasets: [{ label: 'Designs Created', data: designsPerDay, backgroundColor: '#2F6F63', borderRadius: 8, barThickness: 32 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } } }
    });
  }

  // Approval rate trend (mocking weekly trend dynamically based on total approvals for now to avoid zero-flatline, but using real numbers for current week)
  const ctx3 = document.getElementById("approvalLineChart");
  if (ctx3) {
    const weeks = ["W1", "W2", "W3", "W4", "W5", "This Week"];
    const totalOrders = orders.length || 1;
    const approvedOrders = orders.filter(o => ["qty_pending", "in_production", "qc", "ready_for_payment", "paid", "shipped"].includes(o.status)).length;
    const currentRate = Math.round((approvedOrders / totalOrders) * 100);
    const rates = [85, 78, 92, 88, 75, currentRate]; // Keeping some history mock for visual, but anchoring to current dynamic rate

    if (lineChart) lineChart.destroy();
    lineChart = new Chart(ctx3, {
      type: 'line',
      data: {
        labels: weeks,
        datasets: [{ label: 'Approval Rate %', data: rates, borderColor: '#6B8E4E', backgroundColor: 'rgba(107,142,78,0.1)', fill: true, tension: 0.4, pointBackgroundColor: '#6B8E4E', pointRadius: 5, pointHoverRadius: 7 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } }, x: { grid: { display: false } } } }
    });
  }

  // Production Volume
  const ctx4 = document.getElementById("productionVolumeChart");
  if (ctx4) {
    const totalJerseys = orders.reduce((sum, o) => sum + (o.quantity || 0), 0);
    const inProduction = orders.filter(o => o.status === 'in_production').reduce((sum, o) => sum + (o.quantity || 0), 0);
    const completedVol = orders.filter(o => o.status === 'shipped').reduce((sum, o) => sum + (o.quantity || 0), 0);

    if (typeChart) typeChart.destroy();
    typeChart = new Chart(ctx4, {
      type: 'bar',
      data: {
        labels: ['Total Jerseys', 'In Production', 'Completed'],
        datasets: [{ label: 'Volume', data: [totalJerseys, inProduction, completedVol], backgroundColor: ['#2F6F63', '#C1652C', '#6B8E4E'], borderRadius: 8, barThickness: 40 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } }
    });
  }

  // Designer Performance KPIs
  const performanceKPIs = document.getElementById("designerPerformanceKPIs");
  if (performanceKPIs) {
    const totalDesigns = orders.length;
    const approved = orders.filter(o => ["qty_pending", "in_production", "qc", "ready_for_payment", "paid", "shipped"].includes(o.status)).length;
    const mockups = orders.filter(o => o.mockupUrl || o.designPreviewUrl).length;

    performanceKPIs.innerHTML = `
      <div class="kpi-card"><div class="info"><div class="label">Designs Created</div><div class="value">${totalDesigns}</div></div></div>
      <div class="kpi-card"><div class="info"><div class="label">Designs Approved</div><div class="value">${approved}</div></div></div>
      <div class="kpi-card"><div class="info"><div class="label">Mockups Generated</div><div class="value">${mockups}</div></div></div>
      <div class="kpi-card"><div class="info"><div class="label">Avg Approval Time</div><div class="value">N/A</div></div></div>
    `;
  }
}

// ─── Toast ───
function showToast(msg, isError) {
  const container = document.getElementById("toastContainer");
  const t = document.createElement("div");
  t.className = "toast" + (isError ? " error" : "");
  t.innerHTML = `<span class="toast-msg">${msg}</span><button class="toast-close" onclick="this.parentElement.remove()">&times;</button>`;
  container.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ─── Render All ───
function renderAll() {
  try { renderKPIs(); } catch (e) { }
  try { renderDashboardQueue(); } catch (e) { }
  try { renderQueue(); } catch (e) { }
  try { renderHistory(); } catch (e) { }
  try { renderCharts(); } catch (e) { }
  try { populateCanvasOrderSelect(); } catch (e) { }
}

document.addEventListener("DOMContentLoaded", () => {
  renderAll();
  try { switchDesignMode("ai"); } catch (e) { }

  // Check if we navigated directly to canvas with an order ID in URL
  try {
    const params = new URLSearchParams(window.location.search);
    const orderParam = params.get("order");
    if (orderParam && document.getElementById("canvasOrderSelect")) {
      populateCanvasOrderSelect();
      document.getElementById("canvasOrderSelect").value = orderParam;
      loadOrderToCanvas();
    }
  } catch (e) { }
});
