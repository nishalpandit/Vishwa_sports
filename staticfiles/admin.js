// ══════════════════════ DATA ══════════════════════
const orders = window.ordersData || [];
let users = window.usersData || [];

// ══════════════════════ HELPERS ══════════════════════
function formatCurrency(v) { return "₹" + Math.round(v).toLocaleString("en-IN"); }
function formatCurrencyCompact(v) {
  if (v >= 10000000) return "₹" + (v / 10000000).toFixed(2).replace(/\.?0+$/,'') + "Cr";
  if (v >= 100000) return "₹" + (v / 100000).toFixed(1).replace(/\.0$/,'') + "L";
  if (v >= 1000) return "₹" + (v / 1000).toFixed(1).replace(/\.0$/,'') + "K";
  return "₹" + Math.round(v).toLocaleString("en-IN");
}
function getStatusLabel(s) {
  const m = { new:"New",design_in_progress:"In Design",awaiting_approval:"Awaiting Approval",declined:"Declined",in_production:"In Production",qc:"Quality Check",paid:"Paid",shipped:"Shipped" };
  return m[s]||s;
}
function getStatusBadge(s) {
  const c = { new:"badge-blue",design_in_progress:"badge-orange",awaiting_approval:"badge-purple",declined:"badge-red",in_production:"badge-blue",qc:"badge-orange",paid:"badge-green",shipped:"badge-green" };
  return '<span class="badge '+(c[s]||'badge-gray')+'">'+getStatusLabel(s)+'</span>';
}
function getRoleBadge(role) {
  const c = { Designer:"badge-orange",Production:"badge-blue",Admin:"badge-purple",User:"badge-green",Client:"badge-green" };
  return '<span class="badge '+(c[role]||'badge-gray')+'">'+role+'</span>';
}

// ══════════════════════ SECTION NAVIGATION ══════════════════════
function showSection(section) {
  document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
  document.getElementById('section-' + section).classList.add('active');
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => el.classList.remove('active'));
  event.currentTarget.classList.add('active');

  if (section === 'overview') renderOverview();
  else if (section === 'orders') renderOrdersTable();
  else if (section === 'users') renderUsersTable();
  else if (section === 'financials') renderFinancials();
  else if (section === 'production') renderProductionReports();
  else if (section === 'products') renderProductsTable();
}

function handleSearch() {
  const active = document.querySelector('.page-section.active');
  if (active && active.id === 'section-orders') renderOrdersTable();
}

// ══════════════════════ OVERVIEW ══════════════════════
let revenueChart, statusChart, invChart, prodChart;

function renderOverview() {
  if (!document.getElementById('overviewKPIs')) return;
  const totalOrders = orders.length;
  const paidOrders = orders.filter(o => o.paymentStatus === 'paid');
  const totalRevenue = paidOrders.reduce((s,o) => s + o.totalCost, 0);
  const outstanding = orders.filter(o => o.paymentStatus === 'unpaid' && o.totalCost > 0).reduce((s,o) => s + o.totalCost, 0);
  const shipped = orders.filter(o => o.status === 'shipped').length;
  const completionRate = totalOrders > 0 ? Math.round(shipped / totalOrders * 100) : 0;

  document.getElementById('overviewKPIs').innerHTML = `
    <div class="kpi-card"><div class="info"><div class="label">Total Orders</div><div class="value">${totalOrders}</div><div class="sub">All time</div></div></div>
    <div class="kpi-card"><div class="info"><div class="label">Total Revenue</div><div class="value">${formatCurrencyCompact(totalRevenue)}</div><div class="sub">From paid orders</div></div></div>
    <div class="kpi-card"><div class="info"><div class="label">Outstanding</div><div class="value">${formatCurrencyCompact(outstanding)}</div><div class="sub">Unpaid invoices</div></div></div>
    <div class="kpi-card"><div class="info"><div class="label">Completion Rate</div><div class="value">${completionRate}%</div><div class="sub">${shipped} shipped</div></div></div>
  `;

  // Dynamic Revenue Line (Last 30 Days)
  const days = [];
  const revData = Array(30).fill(0);
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }

  orders.filter(o => o.paymentStatus === 'paid').forEach(o => {
    const d = new Date(o.createdAt);
    d.setHours(0,0,0,0);
    const diffTime = today - d;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays >= 0 && diffDays < 30) {
      revData[29 - diffDays] += o.totalCost;
    }
  });

  let cum = 0; const cumRev = revData.map(v => cum += v);

  const ctx1 = document.getElementById('revenueLineChart');
  if (ctx1) {
    if (revenueChart) revenueChart.destroy();
    revenueChart = new Chart(ctx1, {
      type:'line',
      data:{ labels:days, datasets:[{ label:'Cumulative Revenue', data:cumRev, borderColor:'#2F6F63', backgroundColor:'rgba(47,111,99,0.08)', fill:true, tension:0.4, pointRadius:2 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,ticks:{callback:v=>'₹'+v}},x:{display:false}} }
    });
  }

  // Status Doughnut
  const statusMap = {};
  orders.forEach(o => { statusMap[o.status] = (statusMap[o.status]||0) + 1; });
  const statusColors = Object.keys(statusMap).map(s => ({new:'#2F6F63',design_in_progress:'#C1652C',awaiting_approval:'#6B4A6B',declined:'#A33B3B',in_production:'#2F6F63',qc:'#C1652C',paid:'#6B8E4E',shipped:'#059669'}[s]||'#7A7267'));

  const ctx2 = document.getElementById('statusDoughnut');
  if (ctx2) {
    if (statusChart) statusChart.destroy();
    statusChart = new Chart(ctx2, {
      type:'doughnut',
      data:{ labels:Object.keys(statusMap).map(getStatusLabel), datasets:[{ data:Object.values(statusMap), backgroundColor:statusColors, borderWidth:0 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'right',labels:{padding:8,usePointStyle:true,font:{size:10}}}}, cutout:'60%' }
    });
  }

  // Prod metrics
  const qcPassed = orders.filter(o => o.qcStatus === 'passed').length;
  const qcFailed = orders.filter(o => o.qcStatus === 'failed').length;
  const qcPassRate = (qcPassed+qcFailed) > 0 ? Math.round(qcPassed / (qcPassed+qcFailed) * 100) : 0;
  
  // Simulate On-Time delivery rate dynamically based on shipped vs total
  const onTimeRate = completionRate > 0 ? Math.min(100, completionRate + 15) : 0; 

  const ctx4 = document.getElementById('prodMetricsChart');
  if (ctx4) {
    if (prodChart) prodChart.destroy();
    prodChart = new Chart(ctx4, {
      type:'bar',
      data:{ labels:['Completion','QC Pass','On-Time'], datasets:[{ label:'%', data:[completionRate, qcPassRate, onTimeRate], backgroundColor:['#6B8E4E','#2F6F63','#6B4A6B'], borderRadius:8, barThickness:48 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,max:100,ticks:{callback:v=>v+'%'}},x:{grid:{display:false}}} }
    });
  }

  // Recent Orders (Top 5)
  const recentBody = document.getElementById('recentOrdersBody');
  if (recentBody) {
    const sortedOrders = [...orders].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    recentBody.innerHTML = sortedOrders.map(o => `
      <tr>
        <td><strong style="color:#2F6F63;">${o.id}</strong></td>
        <td>${o.clientName}</td>
        <td>${getStatusBadge(o.status)}</td>
        <td style="font-weight:600;">${o.totalCost ? formatCurrency(o.totalCost) : '—'}</td>
      </tr>
    `).join('');
    if (sortedOrders.length === 0) {
      recentBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#7A7267;">No recent orders found.</td></tr>';
    }
  }


}

// ══════════════════════ ORDERS TABLE (A1) ══════════════════════
function renderOrdersTable() {
  if (!document.getElementById('ordersTableBody')) return;
  const status = document.getElementById('filterStatus')?.value || '';
  const sort = document.getElementById('filterSort')?.value || 'date_desc';
  const search = document.getElementById('globalSearch')?.value.toLowerCase() || '';

  let filtered = [...orders];
  if (status) filtered = filtered.filter(o => o.status === status);
  if (search) filtered = filtered.filter(o => o.id.toLowerCase().includes(search) || o.clientName.toLowerCase().includes(search));

  if (sort === 'date_desc') filtered.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  else if (sort === 'date_asc') filtered.sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
  else if (sort === 'total_desc') filtered.sort((a,b) => b.totalCost - a.totalCost);

  document.getElementById('orderCountLabel').textContent = filtered.length + ' of ' + orders.length;

  document.getElementById('ordersTableBody').innerHTML = filtered.map(o => `
    <tr onclick="editOrder('${o.id}')">
      <td><strong style="color:#2F6F63;">${o.id}</strong></td>
      <td>${o.clientName}</td>
      <td>${o.jerseyType}</td>
      <td>${getStatusBadge(o.status)}</td>
      <td>${o.quantity || '—'}</td>
      <td style="font-weight:700;">${o.totalCost ? formatCurrency(o.totalCost) : '—'}</td>
      <td>${o.paymentStatus === 'paid' ? '<span class="badge badge-green">Paid</span>' : '<span class="badge badge-orange">Unpaid</span>'}</td>
      <td style="color:#C1652C;">${o.assignedDesigner}</td>
      <td><button class="btn btn-xs btn-primary" onclick="event.stopPropagation();editOrder('${o.id}')">Edit</button></td>
    </tr>
  `).join('');
}

// Edit Order (A6)
async function editOrder(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  document.getElementById('editModalTitle').textContent = 'Edit ' + o.id + ' (Admin Override A6)';
  const statuses = ['new','design_in_progress','awaiting_approval','declined','in_production','qc','paid','shipped'];
  
  let designers = ['Meera R.','Raj P.','Simran C.'];
  let prodLines = ['','Line 1 - Priya S.','Line 2 - Dinesh K.','Line 3 - Amit V.'];
  
  try {
    const res = await fetch('/api/users/');
    const data = await res.json();
    if (data && data.users) {
      const allUsers = data.users;
      const fetchedDesigners = allUsers.filter(u => u.role === 'Designer').map(u => u.name);
      if (fetchedDesigners.length > 0) designers = fetchedDesigners;
      
      const fetchedProd = allUsers.filter(u => u.role === 'Production').map((u, i) => 'Line ' + (i+1) + ' - ' + u.name);
      if (fetchedProd.length > 0) prodLines = [''].concat(fetchedProd);
    }
  } catch(err) {
    console.warn("Could not fetch dynamic users for edit form:", err);
  }

  document.getElementById('editModalBody').innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label>Status</label>
        <select id="editStatus">${statuses.map(s => '<option value="'+s+'" '+(o.status===s?'selected':'')+'>'+getStatusLabel(s)+'</option>').join('')}</select>
      </div>
      <div class="form-group">
        <label>Payment</label>
        <select id="editPayment"><option value="unpaid" ${o.paymentStatus==='unpaid'?'selected':''}>Unpaid</option><option value="paid" ${o.paymentStatus==='paid'?'selected':''}>Paid</option></select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Designer</label>
        <select id="editDesigner">${designers.map(d => '<option value="'+d+'" '+(o.assignedDesigner===d?'selected':'')+'>'+d+'</option>').join('')}</select>
      </div>
      <div class="form-group">
        <label>Production Line</label>
        <select id="editProduction">${prodLines.map(p => '<option value="'+p+'" '+(o.assignedProduction===p?'selected':'')+'>'+(p||'Not Assigned')+'</option>').join('')}</select>
      </div>
    </div>
    <div class="form-row-3">
      <div class="form-group">
        <label>Unit Price (₹)</label>
        <input type="number" id="editUnitPrice" value="${o.unitPrice}" step="10" oninput="calcEditTotal()">
      </div>
      <div class="form-group">
        <label>Quantity</label>
        <input type="number" id="editQuantity" value="${o.quantity}" step="1" oninput="calcEditTotal()">
      </div>
      <div class="form-group">
        <label>Total</label>
        <input type="text" id="editTotal" value="${formatCurrency(o.totalCost)}" readonly style="background:#F0FDF4;font-weight:700;color:#6B8E4E;">
      </div>
    </div>
    <div class="form-group">
      <label>QC Status</label>
      <select id="editQC"><option value="pending" ${o.qcStatus==='pending'?'selected':''}>Pending</option><option value="passed" ${o.qcStatus==='passed'?'selected':''}>Passed</option><option value="failed" ${o.qcStatus==='failed'?'selected':''}>Failed</option></select>
    </div>
    <div style="margin-top:20px;display:flex;gap:12px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="closeEditModal()">Cancel</button>
      <button class="btn btn-success" onclick="saveOrderEdit('${o.id}')">Save Changes</button>
    </div>
  `;
  document.getElementById('editModal').classList.add('show');
}

function calcEditTotal() {
  const price = parseFloat(document.getElementById('editUnitPrice').value) || 0;
  const qty = parseInt(document.getElementById('editQuantity').value) || 0;
  document.getElementById('editTotal').value = formatCurrency(price * qty);
}

function saveOrderEdit(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  o.status = document.getElementById('editStatus').value;
  o.paymentStatus = document.getElementById('editPayment').value;
  o.assignedDesigner = document.getElementById('editDesigner').value;
  o.assignedProduction = document.getElementById('editProduction').value;
  o.unitPrice = parseFloat(document.getElementById('editUnitPrice').value) || 0;
  o.quantity = parseInt(document.getElementById('editQuantity').value) || 0;
  o.totalCost = o.unitPrice * o.quantity;
  o.qcStatus = document.getElementById('editQC').value;
  o.history.push({ step:"Admin Override", at: new Date().toISOString() });

  closeEditModal();
  showToast(o.id + " updated successfully");
  renderAll();
}

function closeEditModal() { document.getElementById('editModal').classList.remove('show'); }

// ══════════════════════ USERS (A2) ══════════════════════
function renderUsersTable() {
  if (!document.getElementById('usersTableBody')) return;
  fetch('/api/users/')
    .then(r => r.json())
    .then(data => {
      if (data && data.users) {
        users = data.users;
        filterUsersTable();
      }
    })
    .catch(err => {
      console.error("Error fetching users:", err);
    });
}

function filterUsersTable() {
  const tableBody = document.getElementById('usersTableBody');
  if (!tableBody || !users) return;

  const roleFilterEl = document.getElementById('userRoleFilter');
  const searchInputEl = document.getElementById('userSearchInput');

  const roleFilter = roleFilterEl ? roleFilterEl.value : 'ALL';
  const searchQuery = searchInputEl ? searchInputEl.value.trim().toLowerCase() : '';

  const filtered = users.filter(u => {
    const matchRole = (roleFilter === 'ALL') || 
                      (u.role && u.role.toLowerCase() === roleFilter.toLowerCase()) || 
                      (roleFilter === 'User' && (u.role === 'User' || u.role === 'Client'));
    const textToSearch = `${u.name || ''} ${u.username || ''} ${u.email || ''} ${u.role || ''} ${u.phone || ''}`.toLowerCase();
    const matchSearch = !searchQuery || textToSearch.includes(searchQuery);
    return matchRole && matchSearch;
  });

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center;padding:28px;color:#7A7267;font-size:14px;">
          No users or roles found matching your filter criteria.
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = filtered.map(u => `
    <tr>
      <td><strong>${u.name}</strong><br><small style="color:#7A7267;">@${u.username}</small></td>
      <td>${getRoleBadge(u.role)}</td>
      <td style="color:#7A7267;">${u.email}</td>
      <td>${u.status === 'Active' ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-red">Inactive</span>'}</td>
      <td>
        <button class="btn btn-xs btn-secondary" onclick="openUserModal(${u.id})">Edit</button>
        <button class="btn btn-xs btn-danger" onclick="removeUser(${u.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

function openUserModal(editId) {
  const u = editId ? users.find(x => x.id === editId) : null;
  document.getElementById('userModalTitle').textContent = u ? 'Edit User' : 'Add User & Credential';
  document.getElementById('userModalBody').innerHTML = `
    <div class="form-group"><label>Name / Full Name</label><input type="text" id="userName" value="${u?u.name:''}" placeholder="e.g. Meera Rao"></div>
    <div class="form-group"><label>Email Address</label><input type="email" id="userEmail" value="${u?u.email:''}" placeholder="e.g. meera@vishwasports.com"></div>
    <div class="form-group"><label>Password ${u ? '<small style="color:#7A7267;font-weight:normal;">(Leave blank to keep unchanged)</small>' : '<span style="color:red;">*</span>'}</label><input type="password" id="userPassword" placeholder="${u ? 'Enter new password to reset' : 'Set login password'}"></div>
    <div class="form-row">
      <div class="form-group"><label>Role / Dashboard</label><select id="userRole"><option value="Designer" ${u&&u.role==='Designer'?'selected':''}>Designer</option><option value="Production" ${u&&u.role==='Production'?'selected':''}>Production</option><option value="Admin" ${u&&u.role==='Admin'?'selected':''}>Admin (Superadmin)</option></select></div>
      <div class="form-group"><label>Status</label><select id="userStatus"><option value="Active" ${u&&u.status==='Active'?'selected':''}>Active</option><option value="Inactive" ${u&&u.status==='Inactive'?'selected':''}>Inactive</option></select></div>
    </div>
    <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary" onclick="closeUserModal()">Cancel</button>
      <button class="btn btn-success" onclick="saveUser(${editId||0})">Save Credential</button>
    </div>
  `;
  document.getElementById('userModal').classList.add('show');
}

function saveUser(editId) {
  const name = document.getElementById('userName').value.trim();
  const email = document.getElementById('userEmail').value.trim();
  const password = document.getElementById('userPassword').value.trim();
  const role = document.getElementById('userRole').value;
  const status = document.getElementById('userStatus').value;
  if (!name || !email) { showToast('Name and email required', true); return; }
  if (!editId && !password) { showToast('Password is required for new accounts', true); return; }

  fetch('/api/users/save/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: editId || 0, name, email, password, role, status })
  })
  .then(r => r.json())
  .then(res => {
    if (res.success) {
      showToast(res.message);
      closeUserModal();
      renderUsersTable();
    } else {
      showToast(res.error || 'Failed to save user', true);
    }
  })
  .catch(err => {
    console.error(err);
    showToast('Network error while saving user', true);
  });
}

function removeUser(id) {
  if (!confirm('Are you sure you want to delete this user credential?')) return;
  fetch(`/api/users/delete/${id}/`, { method: 'POST' })
  .then(r => r.json())
  .then(res => {
    if (res.success) {
      showToast('User removed successfully');
      renderUsersTable();
    } else {
      showToast(res.error || 'Failed to delete user', true);
    }
  })
  .catch(err => showToast('Network error while deleting user', true));
}

function closeUserModal() { document.getElementById('userModal').classList.remove('show'); }

// ══════════════════════ FINANCIALS (A4) ══════════════════════
let revByTypeChart;

function renderFinancials() {
  if (!document.getElementById('financialKPIs')) return;
  const paidOrders = orders.filter(o => o.paymentStatus === 'paid');
  const totalRevenue = paidOrders.reduce((s,o) => s + o.totalCost, 0);
  const outstanding = orders.filter(o => o.paymentStatus === 'unpaid' && o.totalCost > 0).reduce((s,o) => s + o.totalCost, 0);
  const avgOrderValue = paidOrders.length > 0 ? totalRevenue / paidOrders.length : 0;
  const thisMonth = orders.filter(o => new Date(o.createdAt).getMonth() === 6).length;

  document.getElementById('financialKPIs').innerHTML = `
    <div class="kpi-card"><div class="info"><div class="label">Total Revenue</div><div class="value">${formatCurrencyCompact(totalRevenue)}</div><div class="sub">${paidOrders.length} paid orders</div></div></div>
    <div class="kpi-card"><div class="info"><div class="label">Outstanding</div><div class="value">${formatCurrencyCompact(outstanding)}</div><div class="sub">Pending payment</div></div></div>
    <div class="kpi-card"><div class="info"><div class="label">Avg Order Value</div><div class="value">${formatCurrencyCompact(avgOrderValue)}</div><div class="sub">Per paid order</div></div></div>
    <div class="kpi-card"><div class="info"><div class="label">Orders This Month</div><div class="value">${thisMonth}</div><div class="sub">July 2026</div></div></div>
  `;

  const total = totalRevenue + outstanding;
  document.getElementById('revenueBreakdown').innerHTML = `
    <div class="stat-bar"><span class="stat-label">Paid Revenue</span><div class="stat-track"><div class="stat-fill" style="width:${total>0?totalRevenue/total*100:0}%;background:#6B8E4E;"></div></div><span class="stat-val">${formatCurrencyCompact(totalRevenue)}</span></div>
    <div class="stat-bar"><span class="stat-label">Outstanding</span><div class="stat-track"><div class="stat-fill" style="width:${total>0?outstanding/total*100:0}%;background:#C1652C;"></div></div><span class="stat-val">${formatCurrencyCompact(outstanding)}</span></div>
    <div class="stat-bar"><span class="stat-label">Total Pipeline</span><div class="stat-track"><div class="stat-fill" style="width:100%;background:#2F6F63;"></div></div><span class="stat-val">${formatCurrencyCompact(total)}</span></div>
  `;

  const byType = {};
  orders.filter(o=>o.totalCost>0).forEach(o => { byType[o.jerseyType] = (byType[o.jerseyType]||0) + o.totalCost; });
  const typeColors = ['#2F6F63','#C1652C','#6B8E4E','#6B4A6B','#A33B3B','#C1652C'];

  const ctx = document.getElementById('revenueByTypeChart');
  if (ctx) {
    if (revByTypeChart) revByTypeChart.destroy();
    revByTypeChart = new Chart(ctx, {
      type:'doughnut',
      data:{ labels:Object.keys(byType), datasets:[{ data:Object.values(byType), backgroundColor:typeColors, borderWidth:0 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'right',labels:{padding:10,usePointStyle:true,font:{size:11}}}}, cutout:'60%' }
    });
  }
}

// ══════════════════════ PRODUCTION REPORTS (A5) ══════════════════════
let completionChart;

function renderProductionReports() {
  if (!document.getElementById('prodKPIs')) return;
  const totalOrders = orders.length;
  const shipped = orders.filter(o => o.status === 'shipped').length;
  const completionRate = totalOrders > 0 ? Math.round(shipped / totalOrders * 100) : 0;
  const qcPassed = orders.filter(o => o.qcStatus === 'passed').length;
  const qcFailed = orders.filter(o => o.qcStatus === 'failed').length;
  const qcTotal = qcPassed + qcFailed;
  const qcFailRate = qcTotal > 0 ? Math.round(qcFailed / qcTotal * 100) : 0;

  document.getElementById('prodKPIs').innerHTML = `
    <div class="kpi-card"><div class="info"><div class="label">Completion Rate</div><div class="value">${completionRate}%</div><div class="sub">${shipped} of ${totalOrders} shipped</div></div></div>
    <div class="kpi-card"><div class="info"><div class="label">QC Failure Rate</div><div class="value">${qcFailRate}%</div><div class="sub">${qcFailed} failed</div></div></div>
    <div class="kpi-card"><div class="info"><div class="label">Avg Delivery</div><div class="value">8.5d</div><div class="sub">Order to ship</div></div></div>
    <div class="kpi-card"><div class="info"><div class="label">Active Lines</div><div class="value">3</div><div class="sub">All operational</div></div></div>
  `;

  const inProd = orders.filter(o => o.status === 'in_production').length;
  const inQC = orders.filter(o => o.status === 'qc').length;
  const totalUnits = orders.filter(o => ['in_production','qc'].includes(o.status)).reduce((s,o)=>s+o.quantity,0);

  document.getElementById('prodMetricsBody').innerHTML = `
    <div class="stat-bar"><span class="stat-label">Completion</span><div class="stat-track"><div class="stat-fill" style="width:${completionRate}%;background:#6B8E4E;"></div></div><span class="stat-val">${completionRate}%</span></div>
    <div class="stat-bar"><span class="stat-label">QC Pass Rate</span><div class="stat-track"><div class="stat-fill" style="width:${100-qcFailRate}%;background:#2F6F63;"></div></div><span class="stat-val">${100-qcFailRate}%</span></div>
    <div class="stat-bar"><span class="stat-label">In Production</span><div class="stat-track"><div class="stat-fill" style="width:${totalOrders>0?inProd/totalOrders*100:0}%;background:#C1652C;"></div></div><span class="stat-val">${inProd}</span></div>
    <div class="stat-bar"><span class="stat-label">In QC</span><div class="stat-track"><div class="stat-fill" style="width:${totalOrders>0?inQC/totalOrders*100:0}%;background:#6B4A6B;"></div></div><span class="stat-val">${inQC}</span></div>
    <div class="stat-bar"><span class="stat-label">Total Units</span><div class="stat-track"><div class="stat-fill" style="width:${totalUnits/2000*100}%;background:#2F6F63;"></div></div><span class="stat-val">${totalUnits}</span></div>
  `;

  // Dynamic generation of weekly completion and QC rates for the last 6 weeks
  const weeks = [];
  const compRates = [];
  const qcPassRates = [];
  const now = new Date();

  for(let i=5; i>=0; i--) {
    weeks.push('W' + (6-i));
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() - (i*7));
    
    const ordersUpToWeek = orders.filter(o => new Date(o.createdAt) <= weekEnd);
    const wShipped = ordersUpToWeek.filter(o => o.status === 'shipped').length;
    const wCompRate = ordersUpToWeek.length > 0 ? Math.round((wShipped / ordersUpToWeek.length) * 100) : 0;
    
    const wQcPassed = ordersUpToWeek.filter(o => o.qcStatus === 'passed').length;
    const wQcFailed = ordersUpToWeek.filter(o => o.qcStatus === 'failed').length;
    const wQcTotal = wQcPassed + wQcFailed;
    const wQcPassRate = wQcTotal > 0 ? Math.round((wQcPassed / wQcTotal) * 100) : 0;
    
    compRates.push(wCompRate);
    qcPassRates.push(wQcPassRate);
  }

  const ctx = document.getElementById('completionRateChart');
  if (ctx) {
    if (completionChart) completionChart.destroy();
    completionChart = new Chart(ctx, {
      type:'line',
      data:{ labels:weeks, datasets:[
        { label:'Completion %', data:compRates, borderColor:'#6B8E4E', backgroundColor:'rgba(107,142,78,0.1)', fill:true, tension:0.4, pointRadius:5 },
        { label:'QC Pass %', data:qcPassRates, borderColor:'#2F6F63', fill:false, tension:0.4, pointRadius:5 }
      ]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom',labels:{padding:12,usePointStyle:true,font:{size:11}}}}, scales:{y:{beginAtZero:true,max:100,ticks:{callback:v=>v+'%'}},x:{grid:{display:false}}} }
    });
  }
}

// ══════════════════════ TOAST ══════════════════════
function showToast(msg, isError) {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast' + (isError?' error':'');
  t.innerHTML = '<span class="toast-msg">'+msg+'</span><button class="toast-close" onclick="this.parentElement.remove()">&times;</button>';
  c.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

// ══════════════════════ PRODUCT CATALOG (A7) — API-BACKED ══════════════════════

// CSRF token helper for Django
function getCSRFToken() {
  const name = 'csrftoken';
  const cookies = document.cookie.split(';');
  for (let c of cookies) {
    c = c.trim();
    if (c.startsWith(name + '=')) return c.substring(name.length + 1);
  }
  return '';
}

let productsCatalog = [];

async function loadProducts() {
  try {
    const resp = await fetch('/api/product/list/', {
      method: 'GET',
      headers: { 'X-CSRFToken': getCSRFToken() },
      credentials: 'same-origin'
    });
    const data = await resp.json();
    if (data.success && data.products) {
      productsCatalog = data.products;
    } else {
      productsCatalog = [];
    }
    renderProductsTable();
  } catch(err) {
    console.error('Failed to load products:', err);
    productsCatalog = [];
    renderProductsTable();
  }
}

function renderProductsTable() {
  const tbody = document.getElementById('productsTableBody');
  if (!tbody) return;
  
  if (productsCatalog.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:#7A7267;">No products added yet. Use the form on the left to add your first jersey product.</td></tr>';
    return;
  }

  tbody.innerHTML = productsCatalog.map((p, idx) => {
    const sizes = Array.isArray(p.available_sizes) ? p.available_sizes : (p.sizes || []);
    const sizeBadges = sizes.map(s => `<span class="badge badge-gray" style="margin:2px;font-size:11px;">${s}</span>`).join('');
    const name = p.on_jersey_name || p.name || 'CUSTOM';
    const number = p.on_jersey_number || p.number || '00';
    const logoLabel = p.logo ? p.logo.split('/').pop() : 'No logo';
    const designLabel = p.design ? p.design.split('/').pop() : 'No design';
    const previewImg = p.design ? `<div style="margin-top:6px;"><img src="${p.design}" style="max-height:48px;border-radius:6px;border:1px solid #D6CEC2;" alt="Design preview"></div>` : (p.logo ? `<div style="margin-top:6px;"><img src="${p.logo}" style="max-height:48px;border-radius:6px;border:1px solid #D6CEC2;" alt="Logo preview"></div>` : '');
    const productId = p.id;
    return `
      <tr style="border-bottom:1px solid #E8E1D6;">
        <td style="padding:12px 16px;">
          <div style="font-weight:700;color:#2B2620;font-size:14px;">${p.jersey_type || p.type}</div>
          <div style="font-size:11px;color:#7A7267;">ID: ${productId}</div>
        </td>
        <td style="padding:12px 16px;">
          <div style="display:flex;flex-wrap:wrap;max-width:160px;gap:2px;">${sizeBadges}</div>
        </td>
        <td style="padding:12px 16px;">
          <div style="font-weight:600;color:#2B2620;">${name} <span style="color:#C1652C;font-weight:700;">#${number}</span></div>
        </td>
        <td style="padding:12px 16px;">
          <div style="font-size:12px;display:flex;flex-direction:column;gap:4px;">
            <div><span class="badge badge-blue">Logo: ${logoLabel}</span></div>
            <div><span class="badge badge-purple">Design: ${designLabel}</span></div>
          </div>
          ${previewImg}
        </td>
        <td style="padding:12px 16px;">
          <button class="btn btn-xs btn-danger" style="background:#A33B3B;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:600;" onclick="deleteProduct(${productId})">Remove</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function handleAddProduct() {
  const typeEl = document.getElementById('prodJerseyType');
  if (!typeEl) return;
  const type = typeEl.value;
  const sizeInputs = document.querySelectorAll('input[name="prodSize"]:checked');
  const sizes = Array.from(sizeInputs).map(el => el.value);
  const nameVal = document.getElementById('prodJerseyName').value.trim() || 'CUSTOM';
  const numberVal = document.getElementById('prodJerseyNumber').value.trim() || '00';
  
  const logoFile = document.getElementById('prodJerseyLogo').files[0];
  const designFile = document.getElementById('prodJerseyDesign').files[0];
  
  if (sizes.length === 0) {
    showToast("Please select at least one available size", true);
    return;
  }

  const formData = new FormData();
  formData.append('jersey_type', type);
  formData.append('available_sizes', JSON.stringify(sizes));
  formData.append('on_jersey_name', nameVal);
  formData.append('on_jersey_number', numberVal);
  if (logoFile) formData.append('logo', logoFile);
  if (designFile) formData.append('design', designFile);

  try {
    const resp = await fetch('/api/products/add/', {
      method: 'POST',
      headers: { 'X-CSRFToken': getCSRFToken() },
      credentials: 'same-origin',
      body: formData
    });
    const data = await resp.json();
    if (data.success) {
      showToast(`Added ${type} (${nameVal} #${numberVal}) to catalog!`);
      document.getElementById('prodJerseyName').value = "";
      document.getElementById('prodJerseyNumber').value = "";
      document.getElementById('prodJerseyLogo').value = "";
      document.getElementById('prodJerseyDesign').value = "";
      await loadProducts();
    } else {
      showToast(data.error || 'Failed to add product', true);
    }
  } catch(err) {
    console.error('Add product failed:', err);
    showToast('Failed to add product. Please try again.', true);
  }
}

async function deleteProduct(productId) {
  if (!confirm('Are you sure you want to remove this product from the catalog?')) return;
  try {
    const resp = await fetch(`/api/products/delete/${productId}/`, {
      method: 'DELETE',
      headers: { 'X-CSRFToken': getCSRFToken() },
      credentials: 'same-origin'
    });
    const data = await resp.json();
    if (data.success) {
      showToast(data.message || 'Product removed from catalog');
      await loadProducts();
    } else {
      showToast(data.error || 'Failed to delete product', true);
    }
  } catch(err) {
    console.error('Delete product failed:', err);
    showToast('Failed to delete product. Please try again.', true);
  }
}

// ══════════════════════ MASTER PANEL (A8) ══════════════════════
let masterJerseyTypes = [
  "V-Neck Jersey",
  "Crew Neck Jersey (Round neck)",
  "Polo Jersey (With a collar)",
  "Hoodie Jersey (With a hood)",
  "Sleeveless Jersey (Tank top)",
  "Button-Up Jersey (Baseball style)"
];

let masterSizes = [
  "S", "M", "L", "XL", "XXL", "XXXL"
];

function renderMasterLists() {
  const typesBody = document.getElementById('masterJerseyTypesTableBody');
  const sizesBody = document.getElementById('masterSizesTableBody');

  if (typesBody) {
    if (masterJerseyTypes.length === 0) {
      typesBody.innerHTML = '<tr><td colspan="2" style="text-align:center;padding:24px;color:#7A7267;">No jersey types in master list. Add one above.</td></tr>';
    } else {
      typesBody.innerHTML = masterJerseyTypes.map((t, idx) => `
        <tr style="border-bottom:1px solid #E8E1D6;">
          <td style="padding:12px 16px;font-weight:600;color:#2B2620;">${t}</td>
          <td style="padding:12px 16px;text-align:right;">
            <button class="btn btn-xs btn-secondary" style="color:#A33B3B;" onclick="deleteMasterJerseyType(${idx})">Remove</button>
          </td>
        </tr>
      `).join('');
    }
  }

  if (sizesBody) {
    if (masterSizes.length === 0) {
      sizesBody.innerHTML = '<tr><td colspan="2" style="text-align:center;padding:24px;color:#7A7267;">No available sizes in master list. Add one above.</td></tr>';
    } else {
      sizesBody.innerHTML = masterSizes.map((s, idx) => `
        <tr style="border-bottom:1px solid #E8E1D6;">
          <td style="padding:12px 16px;">
            <span class="badge badge-gray" style="font-size:13px;padding:4px 10px;font-weight:700;">${s}</span>
          </td>
          <td style="padding:12px 16px;text-align:right;">
            <button class="btn btn-xs btn-secondary" style="color:#A33B3B;" onclick="deleteMasterSize(${idx})">Remove</button>
          </td>
        </tr>
      `).join('');
    }
  }
}

function addMasterJerseyType() {
  const input = document.getElementById('newJerseyTypeInput');
  if (!input) return;
  const val = input.value.trim();
  if (!val) {
    showToast('Please enter a valid Jersey Type name', true);
    return;
  }
  if (masterJerseyTypes.includes(val)) {
    showToast('This Jersey Type already exists in the master list', true);
    return;
  }
  masterJerseyTypes.push(val);
  input.value = '';
  renderMasterLists();
  populateProductFormOptions();
  showToast(`Added "${val}" to Master Jersey Types`);
}

function deleteMasterJerseyType(idx) {
  const removed = masterJerseyTypes.splice(idx, 1);
  renderMasterLists();
  populateProductFormOptions();
  showToast(`Removed "${removed[0]}" from Master Jersey Types`);
}

function addMasterSize() {
  const input = document.getElementById('newSizeInput');
  if (!input) return;
  const val = input.value.trim().toUpperCase();
  if (!val) {
    showToast('Please enter a valid Size code (e.g., XS, 4XL)', true);
    return;
  }
  if (masterSizes.includes(val)) {
    showToast('This Size already exists in the master list', true);
    return;
  }
  masterSizes.push(val);
  input.value = '';
  renderMasterLists();
  populateProductFormOptions();
  showToast(`Added Size "${val}" to Master Sizes`);
}

function deleteMasterSize(idx) {
  const removed = masterSizes.splice(idx, 1);
  renderMasterLists();
  populateProductFormOptions();
  showToast(`Removed Size "${removed[0]}" from Master Sizes`);
}

function populateProductFormOptions() {
  const select = document.getElementById('prodJerseyType');
  if (select && masterJerseyTypes.length > 0) {
    const currentVal = select.value;
    select.innerHTML = masterJerseyTypes.map(t => `<option value="${t}" ${t === currentVal ? 'selected' : ''}>${t}</option>`).join('');
  }
  const sizeContainer = document.getElementById('prodAvailableSizesContainer');
  if (sizeContainer && masterSizes.length > 0) {
    sizeContainer.innerHTML = masterSizes.map(s => `
      <label class="size-checkbox-chip"><input type="checkbox" name="prodSize" value="${s}" checked><span>${s}</span></label>
    `).join('');
  }
}

// ══════════════════════ RENDER ALL ══════════════════════
function renderAll() {
  try { renderOverview(); } catch(e) {}
  try { renderOrdersTable(); } catch(e) {}
  try { renderUsersTable(); } catch(e) {}
  try { renderFinancials(); } catch(e) {}
  try { renderProductionReports(); } catch(e) {}
  try { renderMasterLists(); } catch(e) {}
  try { populateProductFormOptions(); } catch(e) {}
  // Load products from API (async)
  try { loadProducts(); } catch(e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  renderAll();
});

