const DAILY_CAPACITY = 150;

const orders = window.ordersData || [];

const verificationState = {};
orders.forEach(o => { verificationState[o.id] = { qty: false, sizes: false, design: false, materials: false }; });

const qcState = {};
orders.forEach(o => { qcState[o.id] = { printQuality: null, sizingAccuracy: null, logoPlacement: null }; });

let searchTerm = "";
let selectedVerifyOrder = null;
let selectedQCOrder = null;

// ─── Helpers ───
function formatCurrency(v) { return "₹" + Math.round(v).toLocaleString("en-IN"); }
function sumSizes(sb) { return Object.values(sb).reduce((a,b) => a + b, 0); }
function getStageLabel(s) {
  const m = { verify:"Verify Order", send_to_print:"Send to Print", printing:"Printing", qc:"QC & Completion", done:"Completed" };
  return m[s] || s;
}

// ─── Section Navigation ───
function showSection(section) {
  document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
  document.getElementById('section-' + section).classList.add('active');
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => el.classList.remove('active'));
  event.currentTarget.classList.add('active');

  if (section === 'kanban') renderKanban();
  if (section === 'verification') renderVerificationSection();
  if (section === 'qc') renderQCSection();
  if (section === 'charts') renderCharts();
  if (section === 'dashboard') { renderKPIs(); renderDashboardCharts(); }
}

// ─── KPIs ───
function renderKPIs() {
  if (!document.getElementById("kpiRow")) return;
  const toVerify = orders.filter(o => o.prodStage === "verify").length;
  const inPrint = orders.filter(o => o.prodStage === "printing" || o.prodStage === "send_to_print").length;
  const inQC = orders.filter(o => o.prodStage === "qc").length;
  const readyNotify = orders.filter(o => o.prodStage === "done" && o.status === "ready_for_payment").length;
  const totalUnits = orders.filter(o => ["in_production","qc"].includes(o.status)).reduce((s,o) => s + o.quantity, 0);

  document.getElementById("kpiRow").innerHTML = `
    <div class="kpi-card">
      <div class="info"><div class="label">To Verify</div><div class="value">${toVerify}</div><div class="sub">Awaiting verification</div></div>
    </div>
    <div class="kpi-card">
      <div class="info"><div class="label">In Printing</div><div class="value">${inPrint}</div><div class="sub">${totalUnits} total units</div></div>
    </div>
    <div class="kpi-card">
      <div class="info"><div class="label">In QC</div><div class="value">${inQC}</div><div class="sub">Pending quality check</div></div>
    </div>
    <div class="kpi-card">
      <div class="info"><div class="label">Ready to Notify</div><div class="value">${readyNotify}</div><div class="sub">Awaiting client payment</div></div>
    </div>
  `;
}

// ─── Kanban ───
function filterKanban() {
  searchTerm = document.getElementById("globalSearch")?.value?.toLowerCase() || '';
  renderKanban();
}

function renderKanban() {
  if (!document.getElementById("kanbanBoard")) return;
  const stages = [
    { key:"verify", label:"Verify Order" },
    { key:"send_to_print", label:"Send to Print" },
    { key:"printing", label:"Printing" },
    { key:"qc", label:"QC & Completion" }
  ];

  const kanbanOrders = orders.filter(o => ["verify","send_to_print","printing","qc"].includes(o.prodStage));
  let filtered = kanbanOrders;
  if (searchTerm) {
    filtered = filtered.filter(o => o.id.toLowerCase().includes(searchTerm) || o.clientName.toLowerCase().includes(searchTerm));
  }

  const board = document.getElementById("kanbanBoard");
  board.innerHTML = stages.map(stage => {
    const stageOrders = filtered.filter(o => o.prodStage === stage.key);
    return `
      <div class="kanban-col">
        <div class="kanban-col-header">
          <h4>${stage.label}</h4>
          <span class="count">${stageOrders.length}</span>
        </div>
        ${stageOrders.map(o => {
          const sizeSum = sumSizes(o.sizeBreakdown);
          const sizeMismatch = sizeSum !== o.quantity;
          const estDays = Math.ceil(o.quantity / DAILY_CAPACITY);
          return `
          <div class="kanban-card" onclick="openOrderDetail('${o.id}')">
            <div class="kc-top">
              <span class="kc-id">${o.id}</span>
              <span class="kc-type">${o.jerseyType}</span>
            </div>
            <div class="kc-client">${o.clientName}</div>
            <div class="kc-meta">
              <span>${o.quantity} units</span>
              <span>~${estDays}d est.</span>
            </div>
            ${sizeMismatch ? '<div style="font-size:11px;color:#A33B3B;font-weight:600;">Size mismatch!</div>' : ''}
            <div style="margin-top:6px;font-size:11px;color:#7A7267;">Assigned: ${o.assignedProduction}</div>
            <div class="kc-action">
              <button class="btn btn-xs btn-primary" onclick="event.stopPropagation();moveToNextStage('${o.id}')">→ Next</button>
            </div>
          </div>`;
        }).join('')}
        ${stageOrders.length === 0 ? '<div style="text-align:center;padding:40px 20px;color:#A69C8E;font-size:13px;">No orders</div>' : ''}
      </div>
    `;
  }).join('');
}

function moveToNextStage(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;

  const nextMap = { verify:"send_to_print", send_to_print:"printing", printing:"qc", qc:"done" };
  const nextStage = nextMap[o.prodStage];

  if (o.prodStage === "verify") {
    const v = verificationState[id];
    if (!v.qty || !v.sizes || !v.design || !v.materials) {
      showToast("Complete verification checklist first", true);
      showSection('verification');
      document.querySelectorAll('.sidebar-nav .nav-item')[2].classList.add('active');
      return;
    }
  }
  if (o.prodStage === "qc") {
    const q = qcState[id];
    if (q.printQuality === null || q.sizingAccuracy === null || q.logoPlacement === null) {
      showToast("Complete QC check first", true);
      showSection('qc');
      document.querySelectorAll('.sidebar-nav .nav-item')[3].classList.add('active');
      return;
    }
    if (!q.printQuality || !q.sizingAccuracy || !q.logoPlacement) {
      o.prodStage = "printing";
      o.qcStatus = "failed";
      o.history.push({step:"QC Failed - Back to Printing", at: new Date().toISOString()});
      qcState[id] = { printQuality: null, sizingAccuracy: null, logoPlacement: null };
      showToast(o.id + " failed QC — sent back to printing", true);
      renderAll();
      return;
    }
  }

  o.prodStage = nextStage;
  const stepNames = { send_to_print:"Verified", printing:"Sent to Print", qc:"Print Complete", done:"QC Passed" };
  o.history.push({ step: stepNames[nextStage] || nextStage, at: new Date().toISOString() });

  if (nextStage === "done") {
    o.status = "ready_for_payment";
    o.qcStatus = "passed";
  } else if (nextStage === "qc") {
    o.status = "qc";
  }

  showToast(o.id + " moved to " + getStageLabel(nextStage));
  renderAll();
}

// ─── Verification Section ───
function renderVerificationSection() {
  if (!document.getElementById("verifyOrderList")) return;
  const verifyOrders = orders.filter(o => o.prodStage === "verify");
  document.getElementById("verifyListCount").textContent = verifyOrders.length;
  
  const listEl = document.getElementById("verifyOrderList");
  if (verifyOrders.length === 0) {
    listEl.innerHTML = '<p style="text-align:center;color:#7A7267;padding:20px;">No orders pending verification</p>';
  } else {
    listEl.innerHTML = verifyOrders.map(o => `
      <div style="padding:12px;border:1px solid ${selectedVerifyOrder===o.id?'#6B4A6B':'#E8E1D6'};border-radius:10px;margin-bottom:10px;cursor:pointer;background:${selectedVerifyOrder===o.id?'#F5F3FF':'#fff'};" onclick="selectVerifyOrder('${o.id}')">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="color:#2F6F63;">${o.id}</strong>
          <span class="badge badge-blue">${o.jerseyType}</span>
        </div>
        <div style="font-size:14px;font-weight:600;margin-top:4px;">${o.clientName}</div>
        <div style="font-size:12px;color:#7A7267;margin-top:2px;">📦 ${o.quantity} units</div>
      </div>
    `).join('');
  }
}

function selectVerifyOrder(id) {
  selectedVerifyOrder = id;
  renderVerificationSection();
  renderVerifyPanel(id);
}

function renderVerifyPanel(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  const v = verificationState[id];
  const sizeSum = sumSizes(o.sizeBreakdown);
  const sizeMismatch = sizeSum !== o.quantity;
  const sizeStr = Object.entries(o.sizeBreakdown).map(([k,val]) => `${k}:${val}`).join(', ');

  document.getElementById("verifyPanel").innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
        <span style="font-size:16px;font-weight:700;color:#2F6F63;">${o.id}</span>
        <span class="badge badge-blue">${o.jerseyType}</span>
      </div>
      <div style="font-size:14px;font-weight:600;color:#2B2620;">${o.clientName}</div>
    </div>
    <div style="margin-bottom:16px;">
      <div class="detail-row"><span class="label">Quantity</span><span class="val">${o.quantity} units ${o.quantity < 10 ? '<span class="badge badge-red">Below min!</span>' : ''}</span></div>
      <div class="detail-row"><span class="label">Sizes</span><span class="val">${sizeStr} ${sizeMismatch ? '<span class="badge badge-red">Mismatch!</span>' : '<span class="badge badge-green">✓ Match</span>'}</span></div>
      <div class="detail-row"><span class="label">Unit Price</span><span class="val">${formatCurrency(o.unitPrice)}</span></div>
      <div class="detail-row"><span class="label">Total</span><span class="val">${formatCurrency(o.totalCost)}</span></div>
    </div>
    <h4 style="font-size:13px;font-weight:700;margin-bottom:12px;">Verification Checklist</h4>
    <ul class="checklist">
      <li><input type="checkbox" id="vck_qty_${id}" ${v.qty?'checked':''} onchange="updateVerify('${id}','qty',this.checked)"><span>Quantity confirmed (≥ 10 units)</span></li>
      <li><input type="checkbox" id="vck_sizes_${id}" ${v.sizes?'checked':''} onchange="updateVerify('${id}','sizes',this.checked)"><span>Size breakdown matches quantity</span></li>
      <li><input type="checkbox" id="vck_design_${id}" ${v.design?'checked':''} onchange="updateVerify('${id}','design',this.checked)"><span>Design specs confirmed</span></li>
      <li><input type="checkbox" id="vck_materials_${id}" ${v.materials?'checked':''} onchange="updateVerify('${id}','materials',this.checked)"><span>Materials available in stock</span></li>
    </ul>
    <div style="margin-top:16px;">
      <button class="btn btn-success" id="verifyBtn_${id}" ${Object.values(v).every(Boolean)?'':'disabled'} onclick="moveToNextStage('${id}')">Verify & Send to Print</button>
    </div>
  `;
}

function updateVerify(id, field, val) {
  verificationState[id][field] = val;
  const allChecked = Object.values(verificationState[id]).every(Boolean);
  const btn = document.getElementById("verifyBtn_" + id);
  if (btn) btn.disabled = !allChecked;
}

// ─── QC Section ───
function renderQCSection() {
  if (!document.getElementById("qcOrderList")) return;
  const qcOrders = orders.filter(o => o.prodStage === "qc");
  document.getElementById("qcListCount").textContent = qcOrders.length;
  
  const listEl = document.getElementById("qcOrderList");
  if (qcOrders.length === 0) {
    listEl.innerHTML = '<p style="text-align:center;color:#7A7267;padding:20px;">No orders in QC</p>';
  } else {
    listEl.innerHTML = qcOrders.map(o => `
      <div style="padding:12px;border:1px solid ${selectedQCOrder===o.id?'#6B4A6B':'#E8E1D6'};border-radius:10px;margin-bottom:10px;cursor:pointer;background:${selectedQCOrder===o.id?'#F5F3FF':'#fff'};" onclick="selectQCOrder('${o.id}')">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="color:#C1652C;">${o.id}</strong>
          <span class="badge badge-orange">${o.jerseyType}</span>
        </div>
        <div style="font-size:14px;font-weight:600;margin-top:4px;">${o.clientName}</div>
        <div style="font-size:12px;color:#7A7267;margin-top:2px;">📦 ${o.quantity} units</div>
      </div>
    `).join('');
  }
}

function selectQCOrder(id) {
  selectedQCOrder = id;
  renderQCSection();
  renderQCPanel(id);
}

function renderQCPanel(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  const q = qcState[id];

  const result = computeQCResult(id);
  const resultColor = result === 'Passed' ? '#6B8E4E' : result === 'Failed' ? '#A33B3B' : '#7A7267';
  const resultBg = result === 'Passed' ? '#F0FDF4' : result === 'Failed' ? '#FEF2F2' : '#F9FAFB';

  document.getElementById("qcPanel").innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
        <span style="font-size:16px;font-weight:700;color:#C1652C;">${o.id}</span>
        <span class="badge badge-orange">${o.jerseyType}</span>
      </div>
      <div style="font-size:14px;font-weight:600;color:#2B2620;">${o.clientName} — ${o.quantity} units</div>
    </div>
    <h4 style="font-size:13px;font-weight:700;margin-bottom:12px;">Quality Check Criteria</h4>
    <div class="qc-row">
      <span class="label">Print Quality</span>
      <div class="qc-buttons">
        <button class="btn btn-xs ${q.printQuality===true?'btn-success':'btn-secondary'}" onclick="setQC('${id}','printQuality',true)">✓ Pass</button>
        <button class="btn btn-xs ${q.printQuality===false?'btn-danger':'btn-secondary'}" onclick="setQC('${id}','printQuality',false)">✗ Fail</button>
      </div>
    </div>
    <div class="qc-row">
      <span class="label">Sizing Accuracy</span>
      <div class="qc-buttons">
        <button class="btn btn-xs ${q.sizingAccuracy===true?'btn-success':'btn-secondary'}" onclick="setQC('${id}','sizingAccuracy',true)">✓ Pass</button>
        <button class="btn btn-xs ${q.sizingAccuracy===false?'btn-danger':'btn-secondary'}" onclick="setQC('${id}','sizingAccuracy',false)">✗ Fail</button>
      </div>
    </div>
    <div class="qc-row">
      <span class="label">Logo Placement</span>
      <div class="qc-buttons">
        <button class="btn btn-xs ${q.logoPlacement===true?'btn-success':'btn-secondary'}" onclick="setQC('${id}','logoPlacement',true)">✓ Pass</button>
        <button class="btn btn-xs ${q.logoPlacement===false?'btn-danger':'btn-secondary'}" onclick="setQC('${id}','logoPlacement',false)">✗ Fail</button>
      </div>
    </div>
    <div style="margin-top:16px;padding:14px;border-radius:12px;background:${resultBg};">
      <span style="font-size:13px;font-weight:700;color:${resultColor};">Overall Result: ${result}</span>
    </div>
    <div style="margin-top:16px;">
      <button class="btn ${result==='Failed'?'btn-warning':'btn-success'}" onclick="moveToNextStage('${id}')" ${result==='Incomplete'?'disabled':''}>
        ${result==='Failed'?'Return to Printing':'Complete QC'}
      </button>
    </div>
  `;
}

function setQC(id, field, val) {
  qcState[id][field] = val;
  renderQCPanel(id);
}

function computeQCResult(id) {
  const q = qcState[id];
  if (q.printQuality === null || q.sizingAccuracy === null || q.logoPlacement === null) return "Incomplete";
  if (q.printQuality && q.sizingAccuracy && q.logoPlacement) return "Passed";
  return "Failed";
}

// ─── Order Detail Modal ───
function openOrderDetail(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  document.getElementById("modalTitle").textContent = `${o.id} — ${o.clientName}`;
  const sizeStr = Object.entries(o.sizeBreakdown).map(([k,v]) => `${k}:${v}`).join(', ');
  const sizeSum = sumSizes(o.sizeBreakdown);
  const estDays = Math.ceil(o.quantity / DAILY_CAPACITY);

  document.getElementById("modalBody").innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div>
        <h4 style="font-size:14px;font-weight:700;margin-bottom:12px;">Order Details</h4>
        <div class="detail-row"><span class="label">Jersey Type</span><span class="val">${o.jerseyType}</span></div>
        <div class="detail-row"><span class="label">Quantity</span><span class="val">${o.quantity} units</span></div>
        <div class="detail-row"><span class="label">Size Breakdown</span><span class="val">${sizeStr}</span></div>
        <div class="detail-row"><span class="label">Sum Check</span><span class="val">${sizeSum === o.quantity ? '<span class="badge badge-green">✓ Match</span>' : '<span class="badge badge-red">✗ Mismatch</span>'}</span></div>
        <div class="detail-row"><span class="label">Unit Price</span><span class="val">${formatCurrency(o.unitPrice)}</span></div>
        <div class="detail-row"><span class="label">Total Cost</span><span class="val">${formatCurrency(o.totalCost)}</span></div>
        <div class="detail-row"><span class="label">Est. Completion</span><span class="val">~${estDays} days</span></div>
      </div>
      <div>
        <h4 style="font-size:14px;font-weight:700;margin-bottom:12px;">Production Info</h4>
        <div class="detail-row"><span class="label">Stage</span><span class="val">${getStageLabel(o.prodStage)}</span></div>
        <div class="detail-row"><span class="label">Line</span><span class="val">${o.assignedProduction}</span></div>
        <div class="detail-row"><span class="label">QC Status</span><span class="val">${o.qcStatus === 'passed' ? '<span class="badge badge-green">Passed</span>' : o.qcStatus === 'failed' ? '<span class="badge badge-red">Failed</span>' : '<span class="badge badge-gray">Pending</span>'}</span></div>
        ${o.cutoutUrl ? `
        <div style="margin-top:16px;">
          <h4 style="font-size:14px;font-weight:700;margin-bottom:8px;">2D Cutout (For Printing)</h4>
          <img src="${o.cutoutUrl}" onclick="openFullscreen(this.src)" title="Click to view fullscreen" style="width:100%; border-radius:8px; cursor:zoom-in; border:1px solid #E8E1D6; box-shadow:0 4px 12px rgba(0,0,0,0.1);">
        </div>
        ` : ''}
        <h4 style="font-size:14px;font-weight:700;margin:16px 0 12px;">History</h4>
        <div style="max-height:100px;overflow-y:auto;font-size:12px;color:#7A7267;">${o.history.map(h => '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;"><span style="width:7px;height:7px;border-radius:50%;background:#2F6F63;"></span><span style="font-size:12px;">'+h.step+'</span><span style="font-size:10px;color:#7A7267;margin-left:auto;">'+new Date(h.at).toLocaleDateString()+'</span></div>').join('')}</div>
      </div>
    </div>
    <div style="margin-top:20px;display:flex;gap:12px;justify-content:flex-end;">
      ${o.prodStage === 'done' && o.status === 'ready_for_payment' ? `<button class="btn btn-success" onclick="notifyClient('${o.id}')">Notify Client for Payment</button>` : ''}
      <button class="btn btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;
  document.getElementById("orderModal").classList.add("show");
}

function closeModal() { document.getElementById("orderModal").classList.remove("show"); }

function notifyClient(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  showToast(o.clientName + " notified — " + o.id + " ready for payment (" + formatCurrency(o.totalCost) + ")");
  o.history.push({ step:"Client Notified for Payment", at: new Date().toISOString() });
  closeModal();
}

// ─── Charts ───
let stageChart, qcChart, unitsChart, stageChart2, qcChart2, unitsChart2;

function renderDashboardCharts() {
  const stageCounts = { verify:0, send_to_print:0, printing:0, qc:0 };
  orders.forEach(o => { if (stageCounts.hasOwnProperty(o.prodStage)) stageCounts[o.prodStage]++; });

  const ctx1 = document.getElementById("stageBarChart");
  if (ctx1) {
    if (stageChart) stageChart.destroy();
    stageChart = new Chart(ctx1, {
      type:'bar',
      data:{ labels:["Verify","Send to Print","Printing","QC"], datasets:[{ label:'Orders', data:Object.values(stageCounts), backgroundColor:["#2F6F63","#C1652C","#6B4A6B","#6B8E4E"], borderRadius:8, barThickness:40 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,ticks:{stepSize:1}},x:{grid:{display:false}}} }
    });
  }

  const qcPassed = orders.filter(o => o.qcStatus === "passed").length;
  const qcFailed = orders.filter(o => o.qcStatus === "failed").length;
  const qcPending = orders.filter(o => o.qcStatus === "pending" && ["in_production","qc"].includes(o.status)).length;

  const ctx2 = document.getElementById("qcDoughnut");
  if (ctx2) {
    if (qcChart) qcChart.destroy();
    qcChart = new Chart(ctx2, {
      type:'doughnut',
      data:{ labels:["Passed","Failed","Pending"], datasets:[{ data:[qcPassed,qcFailed,qcPending], backgroundColor:["#6B8E4E","#A33B3B","#C1652C"], borderWidth:0 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom',labels:{padding:14,usePointStyle:true,font:{size:11}}}}, cutout:'65%' }
    });
  }

  const ctx3 = document.getElementById("unitsBarChart");
  if (ctx3) {
    const days = [];
    const units = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      const dailyUnits = orders.filter(o => o.status === 'shipped' && new Date(o.createdAt).getDate() === d.getDate()).reduce((sum, o) => sum + (o.quantity || 0), 0);
      units.push(dailyUnits);
    }
    if (unitsChart) unitsChart.destroy();
    unitsChart = new Chart(ctx3, {
      type:'bar',
      data:{ labels:days, datasets:[{ label:'Units', data:units, backgroundColor:'#2F6F63', borderRadius:6, barThickness:16 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true},x:{grid:{display:false},ticks:{font:{size:9},maxRotation:45}}} }
    });
  }
}

function renderCharts() {
  const stageCounts = { verify:0, send_to_print:0, printing:0, qc:0 };
  orders.forEach(o => { if (stageCounts.hasOwnProperty(o.prodStage)) stageCounts[o.prodStage]++; });

  const ctx1 = document.getElementById("stageBarChart2");
  if (ctx1) {
    if (stageChart2) stageChart2.destroy();
    stageChart2 = new Chart(ctx1, {
      type:'bar',
      data:{ labels:["Verify","Send to Print","Printing","QC"], datasets:[{ label:'Orders', data:Object.values(stageCounts), backgroundColor:["#2F6F63","#C1652C","#6B4A6B","#6B8E4E"], borderRadius:8, barThickness:48 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,ticks:{stepSize:1}},x:{grid:{display:false}}} }
    });
  }

  const qcPassed = orders.filter(o => o.qcStatus === "passed").length;
  const qcFailed = orders.filter(o => o.qcStatus === "failed").length;

  const ctx2 = document.getElementById("qcDoughnut2");
  if (ctx2) {
    if (qcChart2) qcChart2.destroy();
    qcChart2 = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: ['Passed', 'Failed', 'Pending'],
        datasets: [{ data: [15, 2, 8], backgroundColor: ['#6B8E4E','#A33B3B','#A69C8E'], borderWidth: 0 }]
      },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom',labels:{padding:14,usePointStyle:true,font:{size:12}}}}, cutout:'60%' }
    });
  }

  const ctx3 = document.getElementById("unitsBarChart2");
  if (ctx3) {
    const days = [];
    const units = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      const dailyUnits = orders.filter(o => o.status === 'shipped' && new Date(o.createdAt).getDate() === d.getDate()).reduce((sum, o) => sum + (o.quantity || 0), 0);
      units.push(dailyUnits);
    }
    if (unitsChart2) unitsChart2.destroy();
    unitsChart2 = new Chart(ctx3, {
      type:'bar',
      data:{ labels:days, datasets:[{ label:'Units Produced', data:units, backgroundColor:'#2F6F63', borderRadius:6, barThickness:24 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true},x:{grid:{display:false},ticks:{font:{size:10}}}} }
    });
  }
}

// ─── Toast ───
function showToast(msg, isError) {
  const c = document.getElementById("toastContainer");
  const t = document.createElement("div");
  t.className = "toast" + (isError ? " error" : "");
  t.innerHTML = `<span class="toast-msg">${msg}</span><button class="toast-close" onclick="this.parentElement.remove()">&times;</button>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

// ─── Render All ───
function renderAll() {
  try { renderKPIs(); } catch(e) {}
  try { renderKanban(); } catch(e) {}
  try { renderVerificationSection(); } catch(e) {}
  try { renderQCSection(); } catch(e) {}
  try { renderDashboardCharts(); } catch(e) {}
}

document.addEventListener("DOMContentLoaded", () => {
  renderAll();

  if (!document.getElementById("fullscreenModal")) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="fullscreenModal" style="display:none; position:fixed; z-index:999999; left:0; top:0; width:100%; height:100%; overflow:auto; background-color:rgba(0,0,0,0.9); flex-direction:column; justify-content:center; align-items:center;">
        <span onclick="closeFullscreen()" style="position:absolute; top:20px; right:35px; color:#f1f1f1; font-size:40px; font-weight:bold; cursor:pointer; transition:0.3s;">&times;</span>
        <img id="fullscreenImg" style="margin:auto; display:block; max-width:90%; max-height:90%; border-radius:12px; box-shadow:0 0 40px rgba(0,0,0,0.5);">
      </div>
    `);
    document.getElementById('fullscreenModal').addEventListener('click', function(e) {
      if(e.target === this) closeFullscreen();
    });
  }
});

function openFullscreen(src) {
  const img = document.getElementById('fullscreenImg');
  if (img) img.src = src;
  const modal = document.getElementById('fullscreenModal');
  if (modal) modal.style.display = "flex";
}

function closeFullscreen() {
  const modal = document.getElementById('fullscreenModal');
  if (modal) modal.style.display = "none";
}
