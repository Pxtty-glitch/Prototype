/* ======================================================================
   AUTHENTICATION (Firebase Auth — replaces the old SHA-256/localStorage flow)
   ====================================================================== */
function showAuthError(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg; el.classList.add('show');
}
function clearAuthError(elId) {
  const el = document.getElementById(elId);
  el.textContent = ''; el.classList.remove('show');
}

function friendlyFirebaseError(err) {
  const map = {
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/user-not-found': 'Incorrect email or password.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/network-request-failed': 'Network error. Check your connection.'
  };
  return map[err.code] || err.message || 'Something went wrong. Please try again.';
}

function setAuthMode(mode) {
  const shell = document.getElementById('authShell');
  document.querySelectorAll('.auth-tab').forEach(t => {
    const active = t.dataset.auth === mode;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  const form = document.getElementById(mode === 'login' ? 'authLoginForm' : 'authRegisterForm');
  if (form) form.classList.add('active');
  if (shell) shell.classList.toggle('is-register', mode === 'register');
  clearAuthError('loginError');
  clearAuthError('registerError');
}

function initAuthUI() {
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.auth));
  });
  document.querySelectorAll('.auth-mode-switch').forEach(btn => {
    btn.addEventListener('click', () => setAuthMode(btn.dataset.authTarget));
  });

  document.getElementById('authLoginForm').addEventListener('submit', async e => {
    e.preventDefault();
    clearAuthError('loginError');
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) { showAuthError('loginError', 'Please enter both email and password.'); return; }
    const btn = document.getElementById('btnLogin');
    btn.disabled = true; btn.textContent = 'Logging in...';
    try {
      await firebaseAuthInstance.signInWithEmailAndPassword(email, password);
      // onAuthStateChanged (below) takes over from here: loads data, shows the app.
    } catch (err) {
      showAuthError('loginError', friendlyFirebaseError(err));
    } finally {
      btn.disabled = false; btn.textContent = 'Log In';
    }
  });

  document.getElementById('authRegisterForm').addEventListener('submit', async e => {
    e.preventDefault();
    clearAuthError('registerError');
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const password2 = document.getElementById('regPassword2').value;
    if (!name || !email || !password) { showAuthError('registerError', 'All fields are required.'); return; }
    if (password.length < 8) { showAuthError('registerError', 'Password must be at least 8 characters.'); return; }
    if (password !== password2) { showAuthError('registerError', 'Passwords do not match.'); return; }

    const btn = document.getElementById('btnRegister');
    btn.disabled = true; btn.textContent = 'Creating account...';
    try {
      // The backend creates the Firebase Authentication account (via the Admin SDK)
      // and the matching Firestore role profile in one step.
      await api.post('/auth/register', { fullName: name, email, password });
      // Now sign in on the client so the browser has a session.
      await firebaseAuthInstance.signInWithEmailAndPassword(email, password);
    } catch (err) {
      showAuthError('registerError', err.message || 'Registration failed.');
    } finally {
      btn.disabled = false; btn.textContent = 'Create Account';
    }
  });
}

let CURRENT_USER = null;
function isAdmin() { return !!CURRENT_USER && CURRENT_USER.role === 'ADMINISTRATOR'; }

function enterApp(profile) {
  CURRENT_USER = profile;
  document.body.classList.toggle('role-staff', profile.role !== 'ADMINISTRATOR');
  document.body.classList.remove('auth-checking');
  const auth = document.getElementById('authScreen');
  if (auth) { auth.style.display = 'none'; auth.setAttribute('aria-hidden', 'true'); }
  document.getElementById('mainApp').style.display = 'flex';
  document.getElementById('sessionName').textContent = profile.fullName || profile.email;
  document.getElementById('sessionRole').textContent = profile.role === 'ADMINISTRATOR' ? 'ADMINISTRATOR' : 'STAFF';
  const topRole = document.getElementById('sessionTopRole');
  if (topRole) topRole.textContent = profile.role === 'ADMINISTRATOR' ? '◉ ADMIN' : '◉ STAFF';
  document.getElementById('sessionAvatar').textContent = initials(profile.fullName || profile.email);
  renderAll();
}

function showAuthScreen() {
  document.body.classList.remove('auth-checking');
  document.getElementById('mainApp').style.display = 'none';
  const auth = document.getElementById('authScreen');
  auth.style.display = 'flex';
  auth.setAttribute('aria-hidden', 'false');
  setAuthMode('login');
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPassword').value = '';
}

function showAuthChecking() {
  document.body.classList.add('auth-checking');
  const auth = document.getElementById('authScreen');
  auth.style.display = 'none';
  auth.setAttribute('aria-hidden', 'true');
  document.getElementById('mainApp').style.display = 'flex';
}

function logout() {
  firebaseAuthInstance.signOut();
  // onAuthStateChanged fires automatically and shows the auth screen.
}

/* ======================================================================
   DATA LAYER — fetched from the Java/Firebase backend, no localStorage
   ====================================================================== */
const PAYMENT_METHOD_TO_ENUM = { 'Cash Depot': 'CASH', 'GCash Transfer': 'GCASH', 'Bank Transfer': 'BANK_TRANSFER', 'Check': 'CHECK' };
const PAYMENT_METHOD_LABEL = { CASH: 'Cash Depot', GCASH: 'GCash Transfer', BANK_TRANSFER: 'Bank Transfer', CHECK: 'Check' };

function todayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function addMonthsISO(dateStr, months) {
  if (!dateStr || !months) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + Number(months));
  if (d.getDate() !== originalDay) d.setDate(0);
  return d.toISOString().slice(0, 10);
}
function loanDueDate(loan) { return loan.dueDate || addMonthsISO(loan.startDate, loan.term); }
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'2-digit' });
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const a = new Date(todayISO()+'T00:00:00'), b = new Date(dateStr+'T00:00:00');
  return Math.round((b-a)/86400000);
}
function scheduleBucket(loan) {
  if (loan.status === 'fully_paid') return 'all';
  if (loan.status === 'past_due') return 'past_due';
  const d = loanDueDate(loan), n = daysUntil(d);
  if (n === 0) return 'due_today';
  if (n != null && n > 0 && n <= 14) return 'upcoming';
  return 'all';
}
function dueLabel(loan) {
  const bucket = scheduleBucket(loan);
  if (bucket === 'past_due') return 'Past Due';
  if (bucket === 'due_today') return 'Due Today';
  if (bucket === 'upcoming') return 'Upcoming Due';
  return labelStatus(loan.status);
}

function defaultData() {
  return {
    clients: [], loans: [], payments: [],
    settings: {
      companyName: 'La Familia DAVID Lending', tin: '', address: '',
      interestRate: 3, penaltyRate: 2, gracePeriod: 3,
      loanTypes: ['Business Loan', 'Salary Loan', 'Group Loan'],
      autoBackup: true, cloudSync: true
    }
  };
}
let DATA = defaultData();

function mapClient(c) {
  return { id: c.id, name: c.name, address: c.address, contact: c.contactNumber, type: c.type, status: (c.status || 'CURRENT').toLowerCase(), registrationDate: c.registrationDate || '', representative: c.representative || '—', outstandingBalance: Number(c.outstandingBalance || 0) };
}
function mapLoan(l) {
  const principal = Number(l.principal || 0);
  const principalCollected = Number(l.principalPaid || 0);
  const interestCollected = Number(l.interestPaid || 0);
  const totalInterest = Number(l.totalInterest || 0);
  const totalReceivable = Number(l.totalReceivable || 0) || (principal + totalInterest);
  const outstandingBalance = Number(l.outstandingBalance || 0);
  const rawStatus = (l.status || 'CURRENT').toLowerCase();

  // The backend remains authoritative, but the frontend also recognizes a zero
  // remaining balance immediately. This keeps Archive and Loan Desk synchronized
  // even if the API returns the previous status for a moment after a payment.
  const paidEnough = outstandingBalance <= 0.009 ||
    (totalReceivable > 0 && (principalCollected + interestCollected) >= (totalReceivable - 0.009));
  const status = paidEnough && rawStatus !== 'rejected' ? 'fully_paid' : rawStatus;

  return {
    id: l.id, refId: l.refId, clientId: l.clientId, clientName: l.clientName, type: l.type,
    principal, term: l.termMonths, rate: Number(l.interestRatePercent || 0),
    startDate: l.startDate, dueDate: l.dueDate || null, cbu: Number(l.cbu || 0), loanAvailmentGroup: Number(l.groupAvailmentFee || 0),
    principalCollected, interestCollected,
    totalInterest, totalReceivable, outstandingBalance, monthlyAmortization: Number(l.monthlyAmortization || 0),
    // Optional ledger-only fields are preserved when the backend provides them.
    // The print template falls back to the loan type/defaults when they are absent.
    paymentFrequency: l.paymentFrequency || l.frequency || l.paymentSchedule || '',
    paymentDays: l.paymentDays || l.salaryPaymentDays || l.cutoff || '',
    salaryProgram: l.salaryProgram || l.famtea || l.program || '',
    businessSchedule: l.businessSchedule || l.paymentDay || l.scheduleLabel || '',
    groupName: l.groupName || l.groupLabel || l.group || '',
    insurance: Number(l.insurance || l.insurancePerPayment || 0),
    status
  };
}
function mapPayment(p) {
  return {
    id: p.id, loanId: p.loanId, clientId: p.clientId, clientName: p.clientName,
    receiptNo: p.receiptNo || p.refId || p.id || '', refId: p.refId || p.receiptNo || p.id || '',
    amount: Number(p.amount || 0),
    principalApplied: Number(p.principalApplied || 0), interestApplied: Number(p.interestApplied || 0),
    cbuApplied: Number(p.cbuApplied || 0), laApplied: Number(p.laApplied || p.loanAvailmentApplied || 0), insuranceApplied: Number(p.insuranceApplied || 0),
    excess: Number(p.excess || 0), remainingOutstandingBalance: Number(p.remainingOutstandingBalance || 0),
    balanceBeforePayment: Number(p.balanceBeforePayment || 0), balanceAfterPayment: Number(p.balanceAfterPayment || 0),
    voided: !!p.voided, voidedAt: p.voidedAt || null, voidedBy: p.voidedBy || '',
    archived: !!p.archived, archivedAt: p.archivedAt || null, archivedBy: p.archivedBy || '',
    method: PAYMENT_METHOD_LABEL[p.method] || p.method, date: p.date, recordedByName: p.recordedByName || ''
  };
}
function activePayments() { return DATA.payments.filter(p => !p.voided); }
function archivedPayments() { return DATA.payments.filter(p => p.archived); }

const LOAN_RULES_STORAGE_KEY = 'lfd-lms.loanRules.v1';
const CORE_LOAN_RULES = {
  'Business Loan': { interestRate: 5, minTerm: 2, maxTerm: 4 },
  'Salary Loan': { interestRate: 3, minTerm: 1, maxTerm: 12 },
  'Group Loan': { interestRate: 3, minTerm: 1, maxTerm: 6 }
};

function cloneLoanRules(source) {
  return Object.fromEntries(Object.entries(source || {}).map(([key, value]) => [key, {
    interestRate: Number(value?.interestRate ?? 0),
    minTerm: Math.max(1, Number(value?.minTerm ?? 1)),
    maxTerm: Math.max(1, Number(value?.maxTerm ?? 1))
  }]));
}

function readStoredLoanRules() {
  try {
    const raw = localStorage.getItem(LOAN_RULES_STORAGE_KEY);
    if (!raw) return cloneLoanRules(CORE_LOAN_RULES);
    const parsed = JSON.parse(raw);
    const merged = cloneLoanRules(CORE_LOAN_RULES);
    Object.entries(parsed || {}).forEach(([key, value]) => {
      if (value && typeof value === 'object') merged[key] = {
        interestRate: Number(value.interestRate ?? merged[key]?.interestRate ?? 3),
        minTerm: Math.max(1, Number(value.minTerm ?? merged[key]?.minTerm ?? 1)),
        maxTerm: Math.max(1, Number(value.maxTerm ?? merged[key]?.maxTerm ?? 12))
      };
    });
    return merged;
  } catch (err) {
    console.warn('Could not read stored loan rules; using defaults.', err);
    return cloneLoanRules(CORE_LOAN_RULES);
  }
}

function persistLoanRules() {
  try {
    localStorage.setItem(LOAN_RULES_STORAGE_KEY, JSON.stringify(DATA.settings.loanRules || {}));
  } catch (err) {
    console.warn('Could not persist loan rules in this browser.', err);
  }
}

function loanRuleFor(type) {
  const all = DATA.settings.loanRules || {};
  if (!all[type]) {
    all[type] = { interestRate: Number(DATA.settings.interestRate || 3), minTerm: 1, maxTerm: 6 };
    DATA.settings.loanRules = all;
    persistLoanRules();
  }
  const rule = all[type];
  return {
    interestRate: Math.max(0, Number(rule.interestRate || 0)),
    minTerm: Math.max(1, Number(rule.minTerm || 1)),
    maxTerm: Math.max(Math.max(1, Number(rule.minTerm || 1)), Number(rule.maxTerm || 1))
  };
}

function mapSettingsFromApi(s) {
  const loanTypes = s.loanTypes && s.loanTypes.length ? s.loanTypes : ['Business Loan', 'Salary Loan', 'Group Loan'];
  const loanRules = readStoredLoanRules();
  loanTypes.forEach(type => {
    if (!loanRules[type]) loanRules[type] = { interestRate: Number(s.interestRatePercent || 3), minTerm: 1, maxTerm: 6 };
  });
  return {
    companyName: s.companyName || '', tin: s.tin || '', address: s.address || '',
    interestRate: Number(s.interestRatePercent || 0), penaltyRate: Number(s.penaltyRatePercent || 0),
    gracePeriod: s.gracePeriodDays || 0, loanTypes, loanRules,
    autoBackup: !!s.autoBackup, cloudSync: !!s.cloudSync
  };
}

async function loadAllFromApi() {
  const [clients, loans, payments, settings] = await Promise.all([
    api.get('/clients'), api.get('/loans'), api.get('/payments'), api.get('/settings')
  ]);
  DATA.clients = clients.map(mapClient);
  DATA.loans = loans.map(mapLoan);
  DATA.payments = payments.map(mapPayment);
  DATA.settings = mapSettingsFromApi(settings);
}

async function persistSettings() {
  const s = DATA.settings;
  await api.put('/settings', {
    companyName: s.companyName, tin: s.tin, address: s.address,
    interestRatePercent: s.interestRate, penaltyRatePercent: s.penaltyRate, gracePeriodDays: s.gracePeriod,
    loanTypes: s.loanTypes, autoBackup: s.autoBackup, cloudSync: s.cloudSync
  });
}

/* ====================== LOAN MATH (unchanged — pure client-side display math) ====================== */
function loanCalc(loan) {
  const calculatedInterest = loan.principal * (loan.rate / 100) * loan.term;
  const totalInterest = Number.isFinite(loan.totalInterest) && loan.totalInterest > 0 ? loan.totalInterest : calculatedInterest;
  const totalReceivable = Number.isFinite(loan.totalReceivable) && loan.totalReceivable > 0 ? loan.totalReceivable : loan.principal + totalInterest;
  const principalBalance = Math.max(0, loan.principal - loan.principalCollected);
  const interestBalance = Math.max(0, totalInterest - loan.interestCollected);
  const calculatedOutstanding = principalBalance + interestBalance;
  const outstanding = loan.status === 'fully_paid' ? 0 : (Number.isFinite(loan.outstandingBalance) ? loan.outstandingBalance : calculatedOutstanding);
  const totalCollection = loan.principalCollected + loan.interestCollected;
  return { totalInterest, totalReceivable, principalBalance, interestBalance, outstanding, totalCollection };
}

function computeClientOutstanding(clientId) {
  return DATA.loans.filter(l => l.clientId === clientId)
    .reduce((sum, l) => sum + loanCalc(l).outstanding, 0);
}

// Loan status is now fully authoritative from the backend (it self-heals past-due /
// fully-paid detection on every read — see LoanService.reconcileStatus). Kept as a
// no-op call site so existing render functions don't need to change.
function refreshLoanStatuses() { /* status now comes reconciled from the API */ }

/* ====================== NAVIGATION ====================== */
const breadcrumbMap = {
  dashboard: 'DASHBOARD  ›  MANAGEMENT',
  clients: 'CLIENTS  ›  MANAGEMENT',
  clientProfile: 'CLIENTS  ›  PROFILE',
  loandesk: 'LOANS  ›  MANAGEMENT',
  loanDetail: 'LOAN DESK',
  collections: 'PAYMENTS  ›  MANAGEMENT',
  financials: 'REPORTS  ›  MANAGEMENT',
  staffAccount: 'STAFF ACCOUNT  ›  ACCOUNT',
  settings: 'SETTINGS  ›  MANAGEMENT'
};

function showView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + view);
  if (!target) return;
  target.classList.add('active');
  const navView = view === 'loanDetail' ? 'loandesk' : view;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === navView));
  document.getElementById('breadcrumb').textContent = breadcrumbMap[view] || view.toUpperCase();
  document.body.classList.toggle('client-profile-mode', view === 'clientProfile');
  document.body.classList.toggle('staff-account-mode', view === 'staffAccount');
  const statusPill = document.getElementById('systemStatusPill');
  if (statusPill) statusPill.textContent = view === 'staffAccount' ? '● SYSTEM ONLINE' : '● ONLINE';
  renderView(view);
}

function renderView(view) {
  if (view === 'dashboard') renderDashboard();
  if (view === 'clients') renderClients();
  if (view === 'clientProfile' && ACTIVE_CLIENT_PROFILE_ID) renderClientProfile(ACTIVE_CLIENT_PROFILE_ID);
  if (view === 'loandesk') renderLoanDesk();
  if (view === 'loanDetail' && ACTIVE_LOAN_DETAIL_ID) renderLoanDetail(ACTIVE_LOAN_DETAIL_ID);
  if (view === 'collections') renderCollections();
  if (view === 'financials') renderFinancials();
  if (view === 'staffAccount') renderStaffAccount();
  if (view === 'settings') renderSettings();
}
function renderAll() { refreshLoanStatuses(); ['dashboard', 'clients', 'loandesk', 'collections', 'financials', 'staffAccount', 'settings'].forEach(renderView); }

/* ====================== MODAL HELPERS ====================== */
function openModal(html, variant = '') {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-overlay" id="modalOverlay"><div class="modal-box ${variant}">${html}</div></div>`;
  document.getElementById('modalOverlay').addEventListener('click', e => { if (e.target.id === 'modalOverlay') closeModal(); });
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

/* ====================== DASHBOARD ====================== */
async function renderDashboard() {
  const body = document.getElementById('dashboardBody');
  if (!body) return;
  let summary = null;
  try { summary = await api.get('/reports/dashboard'); } catch (err) { console.warn('Dashboard summary endpoint unavailable; using loaded portfolio data.', err); }

  const portfolioLoans = DATA.loans.filter(l => l.status !== 'rejected' && l.status !== 'application');
  const activeLoans = portfolioLoans.filter(l => l.status !== 'fully_paid');
  const today = todayISO();
  const todayPayments = activePayments().filter(p => String(p.date || '').slice(0,10) === today);
  const collectedToday = todayPayments.reduce((s,p) => s + Number(p.amount || 0), 0);
  const dueTodayLoans = activeLoans.filter(l => scheduleBucket(l) === 'due_today');
  const pastDueLoans = activeLoans.filter(l => l.status === 'past_due' || scheduleBucket(l) === 'past_due');
  const dueTodayTarget = dueTodayLoans.reduce((s,l) => s + loanCalc(l).outstanding, 0);
  const outstanding = activeLoans.reduce((s,l) => s + loanCalc(l).outstanding, 0);
  const released = portfolioLoans.reduce((s,l) => s + Number(l.principal || 0), 0);
  const totalInterest = portfolioLoans.reduce((s,l) => s + Number(loanCalc(l).totalInterest || 0), 0);
  const capitalUtilization = released > 0 ? Math.round((outstanding / released) * 100) : 0;
  const pastDueAmount = pastDueLoans.reduce((s,l) => s + loanCalc(l).outstanding, 0);
  const pastDueExposure = outstanding > 0 ? Math.round((pastDueAmount / outstanding) * 100) : 0;
  const nplAmount = pastDueLoans.filter(l => {
    const due = loanDueDate(l); const days = due ? -daysUntil(due) : 0; return days >= 90;
  }).reduce((s,l) => s + loanCalc(l).outstanding, 0);
  const nplRatio = outstanding > 0 ? ((nplAmount / outstanding) * 100) : 0;
  const currentDate = new Date(today + 'T00:00:00');
  const monthKeyNow = today.slice(0,7);
  const disbursedThisMonth = portfolioLoans.filter(l => String(l.startDate || '').slice(0,7) === monthKeyNow).reduce((s,l) => s + Number(l.principal || 0), 0);
  const collectionRate = dueTodayTarget > 0 ? Math.min(100, Math.round((collectedToday / dueTodayTarget) * 100)) : 0;
  const avgLoan = portfolioLoans.length ? released / portfolioLoans.length : 0;
  const portfolioYield = released > 0 ? (totalInterest / released) * 100 : 0;

  const activeCount = activeLoans.length;
  const totalReleasedCount = portfolioLoans.length;
  const lateCount = pastDueLoans.length;

  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  setText('dashCapitalUtilization', capitalUtilization + '%');
  setText('dashCapitalUtilizationSub', peso(outstanding) + ' currently outstanding');
  setText('dashPastDueExposure', pastDueExposure + '%');
  setText('dashPastDueExposureSub', `${pastDueLoans.length} account${pastDueLoans.length === 1 ? '' : 's'} require follow-up`);
  setText('dashNplRatio', nplRatio.toFixed(1) + '%');
  setText('dashDisbursedMonth', peso(disbursedThisMonth));
  setText('dashDisbursedMonthSub', peso(disbursedThisMonth) + ' released');
  setText('dashActiveAccounts', activeCount);
  setText('dashActiveAccountsSub', `${totalReleasedCount} total loan${totalReleasedCount === 1 ? '' : 's'} released`);
  setText('dashCollectionRate', collectionRate + '%');
  setText('dashCollectionRateSub', peso(collectedToday) + ' received today');
  setText('dashAverageLoan', peso(avgLoan));
  setText('dashPortfolioYield', portfolioYield.toFixed(1) + '%');

  const statGrid = document.getElementById('statGrid');
  if (statGrid) {
    statGrid.innerHTML = [
      dashboardStatCard('▣', 'OUTSTANDING RECEIVABLES', peso(outstanding), 'Open account balances', 'blue'),
      dashboardStatCard('₱', 'COLLECTED TODAY', peso(collectedToday), `${todayPayments.length} receipt${todayPayments.length === 1 ? '' : 's'} recorded today`, 'green', 'collected'),
      dashboardStatCard('▤', 'DUE TODAY', peso(dueTodayTarget), `${dueTodayLoans.length} account${dueTodayLoans.length === 1 ? '' : 's'} scheduled`, 'amber', 'due'),
      dashboardStatCard('⚠', 'PAST DUE', peso(pastDueAmount), `${pastDueLoans.length} account${pastDueLoans.length === 1 ? '' : 's'} require follow-up`, 'red', 'pastdue')
    ].join('');
    statGrid.querySelectorAll('[data-dashboard-list]').forEach(card => {
      card.addEventListener('click', () => openDashboardClientList(card.dataset.dashboardList, {
        todayPayments, dueTodayLoans, pastDueLoans
      }));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
      });
    });
  }

  renderDashboardTrendChart('dashboardTrendChart', portfolioLoans);

  setText('dashDueCount', `${dueTodayLoans.length} account${dueTodayLoans.length === 1 ? '' : 's'}`);
  const scheduledHost = document.getElementById('dashScheduledToday');
  if (scheduledHost) {
    scheduledHost.innerHTML = dueTodayLoans.length ? dueTodayLoans.slice(0,6).map(l => `
      <div class="scheduled-empty-row scheduled-live-row">
        <div><b>${escapeHtml(l.clientName || 'Borrower')}</b><small>${escapeHtml(l.type || 'Loan')} · ${escapeHtml(l.refId || '')}</small></div>
        <strong>${peso(loanCalc(l).outstanding)}</strong>
      </div>`).join('') : `<p class="schedule-empty-copy">No payments are scheduled today. Review overdue accounts for immediate follow-up.</p>`;
  }

  const overdue = [...pastDueLoans].sort((a,b) => loanCalc(b).outstanding - loanCalc(a).outstanding).slice(0,3);
  const overdueHost = document.getElementById('dashOverdueList');
  if (overdueHost) {
    overdueHost.innerHTML = overdue.length ? overdue.map(l => {
      const overdueDays = Math.max(0, -(daysUntil(loanDueDate(l)) || 0));
      return `<div class="overdue-row"><div><b>${escapeHtml(l.clientName || 'Borrower')}</b><small>${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue</small></div><strong>${peso(loanCalc(l).outstanding)}</strong><button data-dashboard-loan="${escapeHtml(l.id)}">View account</button></div>`;
    }).join('') : `<div class="dashboard-empty-small">No overdue accounts.</div>`;
    overdueHost.querySelectorAll('[data-dashboard-loan]').forEach(btn => btn.addEventListener('click', () => { ACTIVE_LOAN_DETAIL_ID = btn.dataset.dashboardLoan; showView('loanDetail'); }));
  }

  const assignmentHost = document.getElementById('dashCollectorAssignments');
  if (assignmentHost) {
    const assignmentLoans = [...dueTodayLoans, ...overdue].slice(0,3);
    const collector = CURRENT_USER?.fullName || CURRENT_USER?.email || 'Current Collector';
    assignmentHost.innerHTML = assignmentLoans.length ? assignmentLoans.map((l,i) => `<div class="collector-box"><b>${escapeHtml(collector)}</b><span>${escapeHtml(l.clientName || 'Borrower')}</span></div>`).join('') : `<div class="collector-box"><b>${escapeHtml(CURRENT_USER?.fullName || 'Current Collector')}</b><span>No accounts assigned today</span></div>`;
  }

  const pct = dueTodayTarget > 0 ? Math.min(100, (collectedToday / dueTodayTarget) * 100) : 0;
  setText('dashProgressPct', Math.round(pct) + '%');
  setText('dashProgressCollected', peso(collectedToday) + ' collected');
  setText('dashProgressTarget', peso(dueTodayTarget));
  setText('dashProgressRemaining', peso(Math.max(0, dueTodayTarget - collectedToday)));
  const progressBar = document.getElementById('dashProgressBar'); if (progressBar) progressBar.style.width = pct + '%';

  const types = DATA.settings.loanTypes?.length ? DATA.settings.loanTypes : ['Salary Loan','Group Loan','Business Loan'];
  const categories = types.map(type => {
    const loans = activeLoans.filter(l => String(l.type || '').toLowerCase() === String(type).toLowerCase());
    return { type, label: String(type).replace(/\s+loan$/i,''), amount: loans.reduce((s,l) => s + loanCalc(l).outstanding,0), active: loans.length, due: loans.filter(l => scheduleBucket(l)==='due_today').length, late: loans.filter(l => l.status==='past_due' || scheduleBucket(l)==='past_due').length };
  });
  setText('dashPortfolioActive', activeCount); setText('dashPortfolioDue', dueTodayLoans.length); setText('dashPortfolioLate', lateCount);
  renderDashboardLoanCategory('dashLoanCategoryChart', categories);
  const rowsHost = document.getElementById('dashLoanCategoryRows');
  if (rowsHost) rowsHost.innerHTML = categories.map(c => `<button class="dash-category-row" data-dashboard-category="${escapeHtml(c.type)}"><span>${escapeHtml(c.label)}</span><strong>${peso(c.amount)}</strong></button>`).join('');
  rowsHost?.querySelectorAll('[data-dashboard-category]').forEach(btn => btn.addEventListener('click', () => { currentLoanTab = btn.dataset.dashboardCategory; showView('loandesk'); }));

  // Keep the existing financial analytics panel in sync: dashboard metrics and
  // financial Data Analytics both read the same DATA.loans / DATA.payments source.
  drawChart();
}

function dashboardStatCard(icon, label, value, sub, tone, listType = '') {
  const clickable = !!listType;
  return `<div class="dashboard-stat-card ${tone}${clickable ? ' is-clickable' : ''}"${clickable ? ` data-dashboard-list="${listType}" role="button" tabindex="0" title="View ${label.toLowerCase()} client list"` : ''}><div class="dashboard-stat-icon">${icon}</div><div class="dashboard-stat-arrow">${clickable ? '↗' : '→'}</div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span><small>${escapeHtml(sub)}</small>${clickable ? '<em>View clients</em>' : ''}</div>`;
}

function openDashboardClientList(type, data) {
  const configs = {
    collected: { title: 'Collected Today', subtitle: 'Clients with payments recorded today', tone: 'green' },
    due: { title: 'Due Today', subtitle: 'Clients with a scheduled payment today', tone: 'amber' },
    pastdue: { title: 'Past Due', subtitle: 'Clients with overdue loan balances', tone: 'red' }
  };
  const cfg = configs[type]; if (!cfg) return;
  let rows = [];
  if (type === 'collected') {
    const grouped = new Map();
    data.todayPayments.forEach(p => {
      const loan = DATA.loans.find(l => String(l.id) === String(p.loanId) || String(l.refId) === String(p.loanId));
      const key = String(p.clientId || loan?.clientId || p.clientName || loan?.clientName || p.loanId || Math.random());
      const existing = grouped.get(key) || { clientName: p.clientName || loan?.clientName || 'Borrower', loanId: loan?.id || p.loanId, type: loan?.type || 'Loan', amount: 0, payments: 0 };
      existing.amount += Number(p.amount || 0); existing.payments += 1;
      grouped.set(key, existing);
    });
    rows = [...grouped.values()];
  } else if (type === 'due') {
    rows = data.dueTodayLoans.map(l => ({ clientName: l.clientName || 'Borrower', loanId: l.id, type: l.type || 'Loan', amount: loanCalc(l).outstanding, detail: `Due today · ${l.refId || ''}` }));
  } else {
    rows = data.pastDueLoans.map(l => {
      const due = loanDueDate(l); const overdueDays = due ? Math.max(0, -(daysUntil(due) || 0)) : 0;
      return { clientName: l.clientName || 'Borrower', loanId: l.id, type: l.type || 'Loan', amount: loanCalc(l).outstanding, detail: `${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue` };
    }).sort((a,b) => b.amount - a.amount);
  }
  const list = rows.length ? rows.map(row => `
    <div class="dashboard-client-list-row">
      <div class="dashboard-client-avatar">${escapeHtml(String(row.clientName || 'B').trim().charAt(0).toUpperCase())}</div>
      <div class="dashboard-client-main"><b>${escapeHtml(row.clientName)}</b><span>${escapeHtml(row.type)}${row.detail ? ' · ' + escapeHtml(row.detail) : row.payments ? ` · ${row.payments} payment${row.payments === 1 ? '' : 's'} today` : ''}</span></div>
      <strong>${peso(row.amount)}</strong>
      ${row.loanId ? `<button class="dashboard-view-client" type="button" data-dashboard-loan-view="${escapeHtml(row.loanId)}">View</button>` : ''}
    </div>`).join('') : `<div class="dashboard-client-empty">No clients found for this category.</div>`;

  openModal(`
    <div class="dashboard-client-modal">
      <div class="dashboard-client-modal-head">
        <div><span class="dashboard-list-eyebrow ${cfg.tone}">CLIENT LIST</span><h2>${escapeHtml(cfg.title)}</h2><p>${escapeHtml(cfg.subtitle)}</p></div>
        <button type="button" class="modal-close-btn" data-dashboard-close>×</button>
      </div>
      <div class="dashboard-client-list-summary"><b>${rows.length}</b> client${rows.length === 1 ? '' : 's'}</div>
      <div class="dashboard-client-list">${list}</div>
    </div>
  `, 'dashboard-client-modal-box');

  document.querySelector('[data-dashboard-close]')?.addEventListener('click', closeModal);
  document.querySelectorAll('[data-dashboard-loan-view]').forEach(btn => btn.addEventListener('click', () => {
    ACTIVE_LOAN_DETAIL_ID = btn.dataset.dashboardLoanView;
    closeModal();
    showView('loanDetail');
  }));
}

function renderDashboardTrendChart(hostId, loans) {
  const host = document.getElementById(hostId); if (!host) return;
  const now = new Date(todayISO() + 'T00:00:00');
  const months = [new Date(now.getFullYear(), now.getMonth()-1,1), new Date(now.getFullYear(),now.getMonth(),1)];
  const values = months.map(m => ({
    label:m.toLocaleString('en-PH',{month:'short'}),
    disbursed:loans.filter(l=>{const d=String(l.startDate||'');return d.startsWith(`${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,'0')}`)}).reduce((s,l)=>s+Number(l.principal||0),0),
    collected:activePayments().filter(p=>{const d=String(p.date||'');return d.startsWith(`${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,'0')}`)}).reduce((s,p)=>s+Number(p.amount||0),0)
  }));
  const max=Math.max(1,...values.flatMap(v=>[v.disbursed,v.collected])); const W=470,H=180,p={l:35,r:10,t:18,b:32},pw=W-p.l-p.r,ph=H-p.t-p.b;
  const x=i=>p.l+pw*i/(values.length-1||1), y=v=>p.t+ph-(v/max)*ph;
  const grid=[0,1,2,3].map(i=>{const yy=p.t+ph*i/3;const val=max*(3-i)/3;return `<line x1="${p.l}" y1="${yy}" x2="${W-p.r}" y2="${yy}" stroke="#e6edf2" stroke-dasharray="3 4"/><text x="${p.l-7}" y="${yy+3}" text-anchor="end" font-size="8" fill="#8a98aa">${escapeHtml(shortPeso(val))}</text>`}).join('');
  const path=key=>values.map((v,i)=>`${i?'L':'M'} ${x(i)} ${y(v[key])}`).join(' ');
  const dots=(key,color)=>values.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v[key])}" r="3.2" fill="${color}"/>`).join('');
  host.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Disbursement versus collection"><text x="${W-5}" y="12" text-anchor="end" font-size="8" fill="#1680a1">— Disbursed</text><text x="${W-5}" y="25" text-anchor="end" font-size="8" fill="#2b8b73">— Collected</text>${grid}<path d="${path('disbursed')}" fill="none" stroke="#167e98" stroke-width="2.5"/><path d="${path('collected')}" fill="none" stroke="#2c8b73" stroke-width="2.5"/>${dots('disbursed','#167e98')}${dots('collected','#2c8b73')}${values.map((v,i)=>`<text x="${x(i)}" y="${H-8}" text-anchor="middle" font-size="8" fill="#8a98aa">${v.label}</text>`).join('')}</svg>`;
}

function renderDashboardLoanCategory(hostId, categories) {
  const host=document.getElementById(hostId); if(!host)return;
  const W=760,H=245,p={l:45,r:10,t:20,b:42},pw=W-p.l-p.r,ph=H-p.t-p.b,max=Math.max(1,...categories.map(c=>c.amount)),slot=pw/Math.max(1,categories.length),bw=Math.min(190,slot*.55);
  const grid=[0,1,2,3,4].map(i=>{const yy=p.t+ph*i/4,val=max*(4-i)/4;return `<line x1="${p.l}" y1="${yy}" x2="${W-p.r}" y2="${yy}" stroke="#e7edf2" stroke-dasharray="3 4"/><text x="${p.l-8}" y="${yy+3}" text-anchor="end" font-size="8" fill="#8a98aa">${escapeHtml(shortPeso(val))}</text>`}).join('');
  const bars=categories.map((c,i)=>{const cx=p.l+slot*i+slot/2,h=(c.amount/max)*ph,y=p.t+ph-h;return `<g><rect x="${cx-bw/2}" y="${y}" width="${bw}" height="${Math.max(2,h)}" rx="4" fill="#167e98"/><text x="${cx}" y="${Math.max(12,y-6)}" text-anchor="middle" font-size="9" font-weight="600" fill="#536276">${escapeHtml(peso(c.amount))}</text><text x="${cx}" y="${H-20}" text-anchor="middle" font-size="9" fill="#637389">${escapeHtml(c.label)}</text></g>`}).join('');
  host.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Loan portfolio by category">${grid}${bars || `<text x="50%" y="50%" text-anchor="middle" fill="#8c99a8" font-size="10">No active portfolio data</text>`}</svg>`;
}

function renderCapitalMixChart(hostId, entries, totalOutstanding) {
  const host = document.getElementById(hostId);
  if (!host) return;

  const width = 760;
  const height = 250;
  const pad = { top: 18, right: 10, bottom: 54, left: 48 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxValue = Math.max(1, ...entries.map(x => x.amount));
  const steps = 4;
  const slotWidth = entries.length ? plotWidth / entries.length : plotWidth;
  const barWidth = Math.min(96, Math.max(42, slotWidth * 0.38));

  const y = value => pad.top + plotHeight - (value / maxValue) * plotHeight;
  const grid = Array.from({ length: steps + 1 }, (_, i) => {
    const value = maxValue * (steps - i) / steps;
    const yy = pad.top + plotHeight * i / steps;
    return `
      <line x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" stroke="#e7edf2" stroke-width="1"/>
      <text x="${pad.left - 10}" y="${yy + 3}" text-anchor="end" font-size="10" fill="#8b98aa">${escapeHtml(shortPeso(value))}</text>
    `;
  }).join('');

  const bars = entries.map((item, i) => {
    const center = pad.left + slotWidth * i + slotWidth / 2;
    const barX = center - barWidth / 2;
    const barY = y(item.amount);
    const barHeight = Math.max(2, pad.top + plotHeight - barY);
    const pct = totalOutstanding > 0 ? Math.round(item.amount / totalOutstanding * 100) : 0;
    return `
      <g class="capital-chart-bar" tabindex="0">
        <title>${escapeHtml(item.type)}: ${peso(item.amount)} outstanding (${pct}%)</title>
        <rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="7" fill="#167e98"/>
        <text x="${center}" y="${Math.max(11, barY - 8)}" text-anchor="middle" font-size="10" font-weight="600" fill="#536173">${escapeHtml(peso(item.amount))}</text>
        <text x="${center}" y="${height - 25}" text-anchor="middle" font-size="10" fill="#657286">${escapeHtml(item.label)}</text>
      </g>
    `;
  }).join('');

  const cards = entries.map(item => {
    const pct = totalOutstanding > 0 ? Math.round(item.amount / totalOutstanding * 100) : 0;
    return `
      <div class="mix-summary-card">
        <span>${escapeHtml(item.label)} · ${item.accounts} account${item.accounts === 1 ? '' : 's'}</span>
        <b>${pct}% of open capital</b>
      </div>
    `;
  }).join('');

  host.innerHTML = `
    <div class="capital-chart-wrap">
      <svg class="capital-mix-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Outstanding balance by loan category">
        ${grid}
        <line x1="${pad.left}" y1="${pad.top + plotHeight}" x2="${width - pad.right}" y2="${pad.top + plotHeight}" stroke="#dfe7ec"/>
        ${bars || `<text x="50%" y="50%" text-anchor="middle" fill="#8c99a8" font-size="11">No active portfolio data</text>`}
      </svg>
    </div>
    <div class="mix-summary-grid">
      ${cards || `<div class="empty-state">No active loan categories.</div>`}
    </div>
  `;
}

function shortPeso(value) {
  const n = Number(value) || 0;
  if (n >= 1000000) return `₱${(n / 1000000).toFixed(1)}m`;
  if (n >= 1000) return `₱${Math.round(n / 1000)}k`;
  return `₱${Math.round(n)}`;
}

function serviceAreaFromAddress(address) {
  const raw = String(address || '').trim();
  if (!raw) return 'Unspecified';

  const knownAreas = [
    'Guimba', 'Muñoz', 'Munoz', 'Cabanatuan', 'Talavera', 'Gapan',
    'San Jose', 'Lupao', 'Aritao', 'Bongabon', 'Palayan', 'Carranglan',
    'Licab', 'Aliaga', 'Zaragoza', 'Jaen', 'Santa Rosa', 'Peñaranda',
    'Nueva Ecija'
  ];

  const lower = raw.toLowerCase();
  const match = knownAreas.find(area => lower.includes(area.toLowerCase()));
  if (match) return match === 'Munoz' ? 'Muñoz' : match;

  const parts = raw.split(',').map(x => x.trim()).filter(Boolean);
  return parts.length ? parts[Math.max(0, parts.length - 2)] || parts[0] : 'Unspecified';
}

function statCard(label, value, sub='') {
  return `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${sub?`<div class="stat-sub">${sub}</div>`:''}</div>`;
}
function peso(n) { return '₱' + Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 }); }
function labelStatus(s) {
  return { current: 'Current', past_due: 'Past Due', fully_paid: 'Fully Paid', due_today: 'Due Today', partial_payment: 'Partial Payment' }[s] || s;
}
function initials(name) { return (name || '').split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase(); }

function drawChart() {
  const host = document.getElementById('mainChart');
  if (!host) return;

  const width = 720;
  const height = 190;
  const months = [];
  const now = new Date(`${todayISO()}T00:00:00`);

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      label: d.toLocaleString('en-PH', { month: 'short' }),
      y: d.getFullYear(),
      m: d.getMonth()
    });
  }

  const localDate = value => {
    if (!value) return null;
    const raw = String(value).slice(0, 10);
    const d = new Date(`${raw}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const releases = months.map(mo => DATA.loans
    .filter(l => l.status !== 'rejected')
    .filter(l => {
      const d = localDate(l.startDate);
      return d && d.getFullYear() === mo.y && d.getMonth() === mo.m;
    })
    .reduce((sum, l) => sum + Number(l.principal || 0), 0));

  const payments = months.map(mo => activePayments()
    .filter(p => {
      const d = localDate(p.date);
      return d && d.getFullYear() === mo.y && d.getMonth() === mo.m;
    })
    .reduce((sum, p) => sum + Number(p.amount || 0), 0));

  const maxValue = Math.max(1, ...releases, ...payments);
  const pad = { l: 46, r: 16, t: 20, b: 30 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const x = i => pad.l + (plotW * i / Math.max(1, months.length - 1));
  const y = v => pad.t + plotH - ((Number(v) || 0) / maxValue) * plotH;
  const moneyShort = v => {
    const n = Number(v) || 0;
    if (n >= 1000000) return `₱${(n / 1000000).toFixed(1)}m`;
    if (n >= 1000) return `₱${Math.round(n / 1000)}k`;
    return `₱${Math.round(n)}`;
  };
  const points = series => series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const circles = (series, color) => series.map((v, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.2" fill="${color}"/>`
  ).join('');

  const grid = Array.from({ length: 5 }, (_, i) => {
    const value = maxValue * i / 4;
    const yy = pad.t + plotH - plotH * i / 4;
    return `<line x1="${pad.l}" y1="${yy}" x2="${width - pad.r}" y2="${yy}" stroke="#edf1f4"/>
      <text x="4" y="${yy + 3}" font-size="9" fill="#8993a6">${escapeHtml(moneyShort(value))}</text>`;
  }).join('');

  const labels = months.map((mo, i) =>
    `<text x="${x(i)}" y="${height - 8}" text-anchor="middle" font-size="9" fill="#8993a6">${escapeHtml(mo.label)}</text>`
  ).join('');

  host.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Released capital and collection movement for the last six months">
      ${grid}
      <polyline points="${points(releases)}" fill="none" stroke="#2b8fe4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="${points(payments)}" fill="none" stroke="#d4af37" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${circles(releases, '#2b8fe4')}
      ${circles(payments, '#d4af37')}
      ${labels}
      <g transform="translate(${pad.l},5)">
        <rect x="0" y="0" width="8" height="8" rx="2" fill="#2b8fe4"/>
        <text x="13" y="8" font-size="9" fill="#677588">Released</text>
        <rect x="74" y="0" width="8" height="8" rx="2" fill="#d4af37"/>
        <text x="87" y="8" font-size="9" fill="#677588">Collections</text>
      </g>
    </svg>`;
}

let chartResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(chartResizeTimer);
  chartResizeTimer = setTimeout(drawChart, 120);
});

/* ====================== CLIENTS ====================== */
function clientTypeLabel(type) {
  const value = String(type || 'Individual Loan').trim();
  return value.replace(/\s*Loan$/i, '');
}

const CLIENT_BLOCKLIST_KEY = 'lfd.clientBlocklist.v1';
let currentClientStatusFilter = 'all';

function getClientBlocklist() {
  try {
    const raw = localStorage.getItem(CLIENT_BLOCKLIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (_) {
    return [];
  }
}
function isClientBlacklisted(clientId) {
  return getClientBlocklist().includes(String(clientId));
}
function setClientBlacklisted(clientId, blocked) {
  const id = String(clientId);
  const set = new Set(getClientBlocklist());
  if (blocked) set.add(id); else set.delete(id);
  localStorage.setItem(CLIENT_BLOCKLIST_KEY, JSON.stringify([...set]));
}
function clientDisplayStatus(client) {
  if (isClientBlacklisted(client.id)) return 'blacklisted';
  const status = String(client.status || '').toLowerCase();
  if (status === 'inactive') return 'inactive';
  if (isArchivedClient(client)) return 'inactive';
  return 'active';
}
function clientStatusLabel(status) {
  return status === 'blacklisted' ? 'Blacklisted' : status === 'inactive' ? 'Inactive' : 'Active';
}
function clientStatusPill(status) {
  if (status === 'blacklisted') return '<span class="client-status-pill blacklisted"><i></i> Blacklisted</span>';
  if (status === 'inactive') return '<span class="client-status-pill inactive"><i></i> Inactive</span>';
  return '<span class="client-status-pill active"><i></i> Active</span>';
}

function renderClients() {
  const typeFilter = document.getElementById('clientTypeFilter');
  if (!typeFilter) return;
  const oldType = typeFilter.value || 'all';
  const types = Array.from(new Set([...(DATA.settings.loanTypes || []), ...DATA.clients.map(c => c.type)])).filter(Boolean);
  typeFilter.innerHTML = '<option value="all">All Types</option>' + types.map(t => `<option value="${escapeAttr(t)}">${escapeHtml(clientTypeLabel(t))}</option>`).join('');
  if ([...typeFilter.options].some(o => o.value === oldType)) typeFilter.value = oldType;

  const search = (document.getElementById('clientSearch')?.value || '').toLowerCase().trim();
  const rows = DATA.clients.filter(c => {
    const status = clientDisplayStatus(c);
    if (currentClientStatusFilter !== 'all' && status !== currentClientStatusFilter) return false;
    if (typeFilter.value !== 'all' && c.type !== typeFilter.value) return false;
    const haystack = `${c.name || ''} ${c.contact || ''} ${c.id || ''}`.toLowerCase();
    return !search || haystack.includes(search);
  });

  const counts = { all: DATA.clients.length, active: 0, inactive: 0, blacklisted: 0 };
  DATA.clients.forEach(c => { counts[clientDisplayStatus(c)]++; });
  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value); };
  setText('clientAllCount', counts.all);
  setText('clientActiveCount', counts.active);
  setText('clientInactiveCount', counts.inactive);
  setText('clientBlacklistedCount', counts.blacklisted);
  document.querySelectorAll('.client-status-filter').forEach(btn => btn.classList.toggle('active', btn.dataset.clientStatus === currentClientStatusFilter));

  const tbody = document.getElementById('clientsTableBody');
  if (!tbody) return;
  tbody.innerHTML = rows.map(c => {
    const status = clientDisplayStatus(c);
    const type = normalizedClientLoanType(c.type);
    const iconClass = type.toLowerCase().includes('business') ? 'business' : type.toLowerCase().includes('group') ? 'group' : 'salary';
    return `<tr class="client-reference-row ${status}">
      <td><div class="client-reference-name"><span class="client-reference-icon ${iconClass}">${loanTypeIconSvg(type)}</span><b>${escapeHtml(c.name || '—')}</b></div></td>
      <td><span class="client-reference-contact">${escapeHtml(c.contact || '—')}</span></td>
      <td><span class="client-reference-type ${iconClass}">${escapeHtml(type)}</span></td>
      <td>${clientStatusPill(status)}</td>
      <td class="client-actions client-reference-actions">
        <button class="client-reference-view" type="button" onclick="openClientProfile('${escapeJs(c.id)}')">◉ <span>View</span></button>
        <button class="client-reference-delete" type="button" onclick="deleteClient('${escapeJs(c.id)}')">Delete</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="5"><div class="empty-state">No clients match your search or filter.</div></td></tr>`;
}

document.getElementById('clientSearch')?.addEventListener('input', renderClients);
document.getElementById('clientTypeFilter')?.addEventListener('change', renderClients);
document.querySelectorAll('.client-status-filter').forEach(btn => btn.addEventListener('click', () => {
  currentClientStatusFilter = btn.dataset.clientStatus || 'all';
  renderClients();
}));

/* ====================== CLIENT CREATION + ARCHIVE ====================== */
function getClientLoans(clientId) {
  return DATA.loans.filter(l => l.clientId === clientId);
}

function isArchivedClient(client) {
  const loans = getClientLoans(client.id);
  const settledLoans = loans.filter(l => l.status !== 'rejected');
  return settledLoans.length > 0 && settledLoans.every(l => l.status === 'fully_paid');
}

function renderArchive() {
  const search = (document.getElementById('archiveSearch').value || '').toLowerCase();
  const archived = DATA.clients.filter(c => {
    if (!isArchivedClient(c)) return false;
    return `${c.name} ${c.address} ${c.contact} ${c.type}`.toLowerCase().includes(search);
  });

  document.getElementById('archiveCountText').textContent = `${archived.length} Fully Paid Accounts`;
  document.getElementById('archiveTableBody').innerHTML = archived.map(c => `
    <tr class="archived-row">
      <td><div class="person-cell"><span class="initials">${initials(c.name)}</span><div><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.id || '')}</small></div></div></td>
      <td><b>${escapeHtml(c.address || '—')}</b><small class="blue-text">${escapeHtml(c.contact || '')}</small></td>
      <td>${escapeHtml(c.type || 'Individual Loan')}</td>
      <td><span class="badge archive-badge">FULLY PAID · ARCHIVED</span></td>
      <td class="money">${peso(computeClientOutstanding(c.id))}</td>
      <td class="client-actions"><div class="client-action-group"><button class="registry-action view-action" onclick="openClientProfile('${escapeHtml(c.id)}')">◉ &nbsp;View</button><button class="registry-action delete-registry-action" onclick="deleteClient('${escapeHtml(c.id)}')">♙ &nbsp;Delete</button></div></td>
    </tr>
  `).join('') || `<tr><td colspan="6"><div class="empty-state">No fully paid borrowers are archived yet.</div></td></tr>`;
}

document.getElementById('btnAddClient').addEventListener('click', openClientModal);

let PENDING_CLIENT_LOAN_TYPE = null;

function loanTypeIconSvg(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('business')) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="16" rx="1.8"></rect><path d="M9 4v-1h6v1M8 8h8M8 11h8M8 14h3M13 14h3M8 17h8"></path></svg>`;
  }
  if (t.includes('group')) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"></circle><circle cx="16.5" cy="9" r="2.5"></circle><path d="M3.5 20c.4-3.6 2.3-5.5 5.5-5.5s5.1 1.9 5.5 5.5M14 14.5c2.6-.2 5 1 6 3.8"></path></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2"></circle><path d="M5.5 20c.4-4 2.5-6 6.5-6s6.1 2 6.5 6"></path></svg>`;
}

function normalizedClientLoanType(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('business')) return 'Business Loan';
  if (t.includes('group')) return 'Group Loan';
  return 'Salary Loan';
}

function selectClientLoanType(type) {
  PENDING_CLIENT_LOAN_TYPE = normalizedClientLoanType(type);
  document.querySelectorAll('.client-loan-type-option').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.loanType === PENDING_CLIENT_LOAN_TYPE);
    btn.setAttribute('aria-selected', btn.dataset.loanType === PENDING_CLIENT_LOAN_TYPE ? 'true' : 'false');
  });

  if (PENDING_CLIENT_LOAN_TYPE === 'Salary Loan') {
    setTimeout(() => openSalaryClientForm(), 120);
  } else if (PENDING_CLIENT_LOAN_TYPE === 'Business Loan') {
    setTimeout(() => openBusinessClientForm(), 120);
  } else if (PENDING_CLIENT_LOAN_TYPE === 'Group Loan') {
    setTimeout(() => openGroupClientForm(), 120);
  }
}

const GROUP_CLIENT_DETAILS_KEY = 'lfd.groupClientDetails.v1';
let GROUP_FORM_STATE = null;
let EDITING_CLIENT_ID = null;

function getGroupClientDetailsStore() {
  try {
    const raw = localStorage.getItem(GROUP_CLIENT_DETAILS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveGroupClientDetails(clientId, details) {
  if (!clientId) return;
  try {
    const store = getGroupClientDetailsStore();
    store[clientId] = { ...details, savedAt: new Date().toISOString() };
    localStorage.setItem(GROUP_CLIENT_DETAILS_KEY, JSON.stringify(store));
  } catch (_) {
    // The core group client record still remains saved by the backend.
  }
}

function createGroupMember() {
  return { name: '', contact: '', address: '', idType: '', idNumber: '', role: 'Member' };
}

function groupMemberComplete(member) {
  return !!(member && member.name.trim() && member.contact.trim() && member.address.trim() && member.idType.trim() && member.idNumber.trim());
}

function updateGroupSaveState() {
  if (!GROUP_FORM_STATE) return;
  const count = GROUP_FORM_STATE.members.length;
  const completeCount = GROUP_FORM_STATE.members.filter(groupMemberComplete).length;
  const leaderCount = GROUP_FORM_STATE.members.filter(m => m.role === 'Leader').length;
  const countEl = document.getElementById('groupTotalMembers');
  const completeEl = document.getElementById('groupCompleteCount');
  const saveBtn = document.getElementById('groupClientSaveBtn');
  if (countEl) countEl.innerHTML = `${count} member${count === 1 ? '' : 's'} <span>(minimum 3 required)</span>`;
  if (completeEl) completeEl.textContent = `${completeCount} / ${count} complete`;
  if (saveBtn) saveBtn.disabled = !(GROUP_FORM_STATE.groupName.trim() && count >= 3 && completeCount === count && leaderCount === 1);

  const leader = GROUP_FORM_STATE.members.find(m => m.role === 'Leader' && groupMemberComplete(m));
  const leaderField = document.getElementById('groupLeaderDisplay');
  const leaderContactField = document.getElementById('groupLeaderContactDisplay');
  if (leaderField) leaderField.value = leader ? leader.name : 'Auto-filled from Members';
  if (leaderContactField) leaderContactField.value = leader ? leader.contact : 'Auto-filled from Members';
}

function renderGroupMembers() {
  if (!GROUP_FORM_STATE) return;
  const container = document.getElementById('groupMembersList');
  if (!container) return;
  const active = GROUP_FORM_STATE.activeMemberIndex;
  container.innerHTML = GROUP_FORM_STATE.members.map((member, index) => {
    const complete = groupMemberComplete(member);
    const isOpen = index === active;
    return `
      <div class="group-member-card ${isOpen ? 'open' : ''} ${complete ? 'complete' : 'pending'}" data-index="${index}">
        <button type="button" class="group-member-row" onclick="toggleGroupMember(${index})" aria-expanded="${isOpen ? 'true' : 'false'}">
          <span class="group-member-number">${index + 1}</span>
          <span class="group-member-name">${escapeHtml(member.name || `Member ${index + 1}`)}</span>
          ${complete ? '<span class="group-member-complete">COMPLETE</span>' : '<span class="group-member-pending">PENDING</span>'}
          <span class="group-member-chevron">${isOpen ? '⌃' : '›'}</span>
        </button>
        ${isOpen ? `
          <div class="group-member-body">
            <div class="group-two-col">
              <div>
                <label class="group-field-label">FULL NAME</label>
                <div class="group-input-with-icon"><span>${salaryFieldIcon('person')}</span><input class="group-field-control" data-field="name" value="${escapeAttr(member.name)}" placeholder="" oninput="updateGroupMemberField(${index}, 'name', this.value)"></div>
              </div>
              <div>
                <label class="group-field-label">CONTACT NUMBER</label>
                <div class="group-input-with-icon"><span>${salaryFieldIcon('phone')}</span><input class="group-field-control" data-field="contact" value="${escapeAttr(member.contact)}" placeholder="09XX XXX XXXX" inputmode="tel" oninput="updateGroupMemberField(${index}, 'contact', this.value)"></div>
              </div>
            </div>
            <label class="group-field-label">HOME ADDRESS</label>
            <div class="group-input-with-icon group-full-width"><span>${salaryFieldIcon('pin')}</span><input class="group-field-control" data-field="address" value="${escapeAttr(member.address)}" oninput="updateGroupMemberField(${index}, 'address', this.value)"></div>
            <div class="group-two-col">
              <div>
                <label class="group-field-label">VALID ID TYPE</label>
                <div class="group-input-with-icon"><span>${salaryFieldIcon('id')}</span><input class="group-field-control" data-field="idType" value="${escapeAttr(member.idType)}" oninput="updateGroupMemberField(${index}, 'idType', this.value)"></div>
              </div>
              <div>
                <label class="group-field-label">ID NUMBER</label>
                <input class="group-field-control" data-field="idNumber" value="${escapeAttr(member.idNumber)}" placeholder="ID number" oninput="updateGroupMemberField(${index}, 'idNumber', this.value)">
              </div>
            </div>
            <label class="group-field-label role-label">ROLE IN GROUP</label>
            <div class="group-role-toggle">
              <button type="button" class="group-role-btn ${member.role === 'Member' ? 'active' : ''}" onclick="setGroupMemberRole(${index}, 'Member')">${salaryFieldIcon('person')}<b>Member</b></button>
              <button type="button" class="group-role-btn ${member.role === 'Leader' ? 'active' : ''}" onclick="setGroupMemberRole(${index}, 'Leader')">☆ <b>Leader</b></button>
            </div>
            ${GROUP_FORM_STATE.members.length > 1 ? `<button type="button" class="group-remove-member" onclick="removeGroupMember(${index})">Remove member</button>` : ''}
          </div>
        ` : ''}
      </div>`;
  }).join('');
  updateGroupSaveState();
}

function toggleGroupMember(index) {
  if (!GROUP_FORM_STATE) return;
  GROUP_FORM_STATE.activeMemberIndex = GROUP_FORM_STATE.activeMemberIndex === index ? -1 : index;
  renderGroupMembers();
}

function updateGroupMemberField(index, field, value) {
  if (!GROUP_FORM_STATE || !GROUP_FORM_STATE.members[index]) return;
  GROUP_FORM_STATE.members[index][field] = value;
  updateGroupSaveState();
}

function setGroupMemberRole(index, role) {
  if (!GROUP_FORM_STATE || !GROUP_FORM_STATE.members[index]) return;
  if (role === 'Leader') {
    GROUP_FORM_STATE.members.forEach((m, i) => { if (i !== index) m.role = 'Member'; });
  }
  GROUP_FORM_STATE.members[index].role = role;
  renderGroupMembers();
}

function addGroupMember() {
  if (!GROUP_FORM_STATE) return;
  GROUP_FORM_STATE.activeMemberIndex = GROUP_FORM_STATE.members.length;
  GROUP_FORM_STATE.members.push(createGroupMember());
  renderGroupMembers();
  const scroller = document.getElementById('groupClientFormScroll');
  if (scroller) setTimeout(() => { scroller.scrollTop = scroller.scrollHeight; }, 30);
}

function removeGroupMember(index) {
  if (!GROUP_FORM_STATE || GROUP_FORM_STATE.members.length <= 1) return;
  GROUP_FORM_STATE.members.splice(index, 1);
  GROUP_FORM_STATE.activeMemberIndex = Math.min(index, GROUP_FORM_STATE.members.length - 1);
  renderGroupMembers();
}

function focusGroupSection(sectionId) {
  const scroller = document.getElementById('groupClientFormScroll');
  const section = document.getElementById(sectionId);
  if (scroller && section) scroller.scrollTo({ top: section.offsetTop, behavior: 'smooth' });
  document.querySelectorAll('.group-client-nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.section === sectionId));
}

function openGroupClientForm(clientId = null) {
  PENDING_CLIENT_LOAN_TYPE = 'Group Loan';
  EDITING_CLIENT_ID = clientId ? String(clientId) : null;
  const existing = clientId ? DATA.clients.find(c => String(c.id) === String(clientId)) : null;
  const existingDetails = existing ? (getGroupClientDetailsStore()[existing.id] || {}) : {};
  const existingMembers = Array.isArray(existingDetails.members) && existingDetails.members.length ? existingDetails.members.map(m => ({...createGroupMember(), ...m})) : [createGroupMember()];
  GROUP_FORM_STATE = { groupName: existingDetails.groupName || existing?.name || '', members: existingMembers, activeMemberIndex: 0 };
  openModal(`
    <div class="group-client-modal">
      <div class="group-client-modal-header">
        <div class="group-client-header-left">
          <span class="group-client-header-icon">${loanTypeIconSvg('Group Loan')}</span>
          <div><div class="group-client-kicker">GROUP LOAN</div><h2>${EDITING_CLIENT_ID ? 'Edit Client' : 'Add New Group'}</h2></div>
        </div>
        <button class="group-client-close" type="button" onclick="closeModal()" aria-label="Close">×</button>
      </div>
      <div class="group-client-modal-main">
        <aside class="group-client-nav" aria-label="Group form navigation">
          <div class="group-client-nav-label">NAVIGATE</div>
          <button type="button" class="group-client-nav-item active" data-section="groupInfoSection" onclick="focusGroupSection('groupInfoSection')"><span>${salaryFieldIcon('person')}</span><b>Group Info</b></button>
          <button type="button" class="group-client-nav-item" data-section="groupMembersSection" onclick="focusGroupSection('groupMembersSection')"><span>${loanTypeIconSvg('Group Loan')}</span><b>Members</b></button>
        </aside>
        <div class="group-client-form-scroll" id="groupClientFormScroll">
          <section class="group-client-form-section group-info-section" id="groupInfoSection">
            <div class="group-client-section-title"><span></span>${salaryFieldIcon('person')}<b>GROUP INFORMATION</b></div>
            <label class="group-field-label">GROUP NAME</label>
            <input class="group-field-control group-full-width" id="groupName" type="text" oninput="GROUP_FORM_STATE.groupName = this.value; updateGroupSaveState()">
            <div class="group-two-col group-leader-grid">
              <div><label class="group-field-label">GROUP LEADER</label><input class="group-field-control group-auto-field" id="groupLeaderDisplay" value="Auto-filled from Members" readonly></div>
              <div><label class="group-field-label">LEADER CONTACT</label><input class="group-field-control group-auto-field" id="groupLeaderContactDisplay" value="Auto-filled from Members" readonly></div>
            </div>
            <label class="group-field-label">TOTAL MEMBERS</label>
            <div class="group-total-members" id="groupTotalMembers">1 member <span>(minimum 3 required)</span></div>
          </section>
          <section class="group-client-form-section group-members-section" id="groupMembersSection">
            <div class="group-members-head"><div class="group-client-section-title"><span></span>${loanTypeIconSvg('Group Loan')}<b>MEMBERS</b></div><div class="group-complete-badge" id="groupCompleteCount">0 / 1 complete</div></div>
            <div id="groupMembersList"></div>
            <button type="button" class="group-add-member-btn" onclick="addGroupMember()"><span>＋</span><b>Add Member</b></button>
            <div id="groupClientFormError" class="group-client-form-error" role="alert" aria-live="polite"></div>
          </section>
        </div>
      </div>
      <div class="group-client-modal-footer">
        <button class="group-client-cancel" type="button" onclick="closeModal()">Cancel</button>
        <button class="group-client-save" id="groupClientSaveBtn" type="button" onclick="saveGroupClient()" disabled>${salaryFieldIcon('person')} &nbsp; ${EDITING_CLIENT_ID ? 'Save Changes' : 'Save Group'}</button>
      </div>
    </div>
  `, 'group-client-form-modal');
  renderGroupMembers();
  const scroller = document.getElementById('groupClientFormScroll');
  if (scroller) scroller.addEventListener('scroll', updateGroupActiveNav, { passive: true });
}

function updateGroupActiveNav() {
  const scroller = document.getElementById('groupClientFormScroll');
  if (!scroller) return;
  const sections = ['groupInfoSection','groupMembersSection'].map(id => document.getElementById(id)).filter(Boolean);
  const current = sections.reduce((best, section) => Math.abs(section.offsetTop - scroller.scrollTop) < Math.abs(best.offsetTop - scroller.scrollTop) ? section : best, sections[0]);
  document.querySelectorAll('.group-client-nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.section === current.id));
}

async function saveGroupClient() {
  if (!GROUP_FORM_STATE) return;
  const error = document.getElementById('groupClientFormError');
  const btn = document.getElementById('groupClientSaveBtn');
  const complete = GROUP_FORM_STATE.members.filter(groupMemberComplete);
  const leaderCount = GROUP_FORM_STATE.members.filter(m => m.role === 'Leader').length;
  if (!GROUP_FORM_STATE.groupName.trim()) { if (error) { error.textContent = 'Please enter a group name.'; error.classList.add('show'); } return; }
  if (GROUP_FORM_STATE.members.length < 3 || complete.length !== GROUP_FORM_STATE.members.length) { if (error) { error.textContent = 'Please complete at least 3 members before saving the group.'; error.classList.add('show'); } return; }
  if (leaderCount !== 1) { if (error) { error.textContent = 'Please assign exactly one group leader.'; error.classList.add('show'); } return; }
  btn.disabled = true;
  btn.innerHTML = 'Saving…';
  try {
    const leader = GROUP_FORM_STATE.members.find(m => m.role === 'Leader');
    const payload = { name: GROUP_FORM_STATE.groupName.trim(), contactNumber: leader.contact.trim(), address: leader.address.trim(), type: 'Group Loan' };
    const savedId = EDITING_CLIENT_ID;
    if (savedId) await api.put(`/clients/${encodeURIComponent(savedId)}`, payload);
    else { const created = await api.post('/clients', payload); EDITING_CLIENT_ID = created?.id ? String(created.id) : null; }
    saveGroupClientDetails(savedId || EDITING_CLIENT_ID, { groupName: GROUP_FORM_STATE.groupName.trim(), members: GROUP_FORM_STATE.members });
    closeModal();
    await loadAllFromApi();
    renderAll();
    showView('clients');
    alert(savedId ? 'Group client updated successfully.' : 'Group client added successfully.');
    GROUP_FORM_STATE = null;
    EDITING_CLIENT_ID = null;
  } catch (err) {
    if (error) { error.textContent = err.message || 'Could not save group.'; error.classList.add('show'); }
    btn.disabled = false; btn.innerHTML = `${salaryFieldIcon('person')} &nbsp; Save Group`;
  }
}

const SALARY_CLIENT_DETAILS_KEY = 'lfd.salaryClientDetails.v1';

function getSalaryClientDetailsStore() {
  try {
    const raw = localStorage.getItem(SALARY_CLIENT_DETAILS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveSalaryClientDetails(clientId, details) {
  if (!clientId) return;
  try {
    const store = getSalaryClientDetailsStore();
    store[clientId] = { ...details, savedAt: new Date().toISOString() };
    localStorage.setItem(SALARY_CLIENT_DETAILS_KEY, JSON.stringify(store));
  } catch (_) {
    // The backend still receives and saves the core client record. Extended
    // salary-only fields are an optional frontend supplement until the backend
    // client schema is expanded.
  }
}

function salaryFieldIcon(kind) {
  const common = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  if (kind === 'person') return `<svg viewBox="0 0 24 24" ${common}><circle cx="12" cy="8" r="3.4"></circle><path d="M5.5 20c.4-4 2.5-6.1 6.5-6.1s6.1 2.1 6.5 6.1"></path></svg>`;
  if (kind === 'phone') return `<svg viewBox="0 0 24 24" ${common}><path d="M7 3.8 4.8 5.5c-.6.5-.8 1.3-.5 2.1 2.1 6.6 5.6 10.1 12.2 12.2.8.3 1.6.1 2.1-.5l1.7-2.2-3.1-2.3-1.8 1.1c-1.4-.7-2.9-2.2-3.6-3.6l1.1-1.8L10.6 7 8.3 3.9 7 3.8Z"></path></svg>`;
  if (kind === 'pin') return `<svg viewBox="0 0 24 24" ${common}><path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z"></path><circle cx="12" cy="11" r="2"></circle></svg>`;
  if (kind === 'id') return `<svg viewBox="0 0 24 24" ${common}><rect x="4" y="6" width="16" height="12" rx="2"></rect><circle cx="9" cy="12" r="2"></circle><path d="M13 10h4M13 14h4"></path></svg>`;
  if (kind === 'work') return `<svg viewBox="0 0 24 24" ${common}><rect x="4" y="7" width="16" height="12" rx="2"></rect><path d="M9 7V5h6v2M4 11h16M10 11v2h4v-2"></path></svg>`;
  return '';
}


const BUSINESS_CLIENT_DETAILS_KEY = 'lfd.businessClientDetails.v1';

function getBusinessClientDetailsStore() {
  try {
    const raw = localStorage.getItem(BUSINESS_CLIENT_DETAILS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveBusinessClientDetails(clientId, details) {
  if (!clientId) return;
  try {
    const store = getBusinessClientDetailsStore();
    store[clientId] = { ...details, savedAt: new Date().toISOString() };
    localStorage.setItem(BUSINESS_CLIENT_DETAILS_KEY, JSON.stringify(store));
  } catch (_) {
    // Core client data is still saved through the existing backend endpoint.
  }
}

function openBusinessClientForm(clientId = null) {
  PENDING_CLIENT_LOAN_TYPE = 'Business Loan';
  EDITING_CLIENT_ID = clientId ? String(clientId) : null;
  const existing = clientId ? DATA.clients.find(c => String(c.id) === String(clientId)) : null;
  const existingDetails = existing ? (getBusinessClientDetailsStore()[existing.id] || {}) : {};
  openModal(`
    <div class="business-client-modal">
      <div class="business-client-modal-header">
        <div class="business-client-header-left">
          <span class="business-client-header-icon">${loanTypeIconSvg('Business Loan')}</span>
          <div>
            <div class="business-client-kicker">BUSINESS LOAN</div>
            <h2>${EDITING_CLIENT_ID ? 'Edit Client' : 'Add New Client'}</h2>
          </div>
        </div>
        <button class="business-client-close" type="button" onclick="closeModal()" aria-label="Close">×</button>
      </div>

      <div class="business-client-modal-main">
        <aside class="business-client-nav" aria-label="Client form navigation">
          <div class="business-client-nav-label">NAVIGATE</div>
          <button type="button" class="business-client-nav-item active" data-section="businessOwnerSection" onclick="focusBusinessSection('businessOwnerSection')">
            <span>${salaryFieldIcon('person')}</span><b>Owner Info</b>
          </button>
          <button type="button" class="business-client-nav-item" data-section="businessInfoSection" onclick="focusBusinessSection('businessInfoSection')">
            <span>${salaryFieldIcon('work')}</span><b>Business Info</b>
          </button>
          <button type="button" class="business-client-nav-item" data-section="businessLoanPurposeSection" onclick="focusBusinessSection('businessLoanPurposeSection')">
            <span>${salaryFieldIcon('id')}</span><b>Loan Purpose</b>
          </button>
        </aside>

        <div class="business-client-form-scroll" id="businessClientFormScroll">
          <section class="business-client-form-section" id="businessOwnerSection">
            <div class="business-client-section-title"><span></span>${salaryFieldIcon('person')}<b>OWNER INFORMATION</b></div>

            <label class="business-field-label" for="businessOwnerName">FULL NAME</label>
            <input class="business-field-control" id="businessOwnerName" type="text" autocomplete="name" required>

            <label class="business-field-label" for="businessOwnerContact">CONTACT NUMBER</label>
            <div class="business-input-with-icon"><span>${salaryFieldIcon('phone')}</span><input class="business-field-control" id="businessOwnerContact" type="tel" inputmode="tel" placeholder="09XX XXX XXXX" autocomplete="tel" required></div>

            <label class="business-field-label" for="businessOwnerAddress">HOME ADDRESS</label>
            <div class="business-input-with-icon business-full-width"><span>${salaryFieldIcon('pin')}</span><input class="business-field-control" id="businessOwnerAddress" type="text" autocomplete="street-address" required></div>

            <div class="business-two-col">
              <div>
                <label class="business-field-label" for="businessIdType">VALID ID TYPE</label>
                <input class="business-field-control" id="businessIdType" type="text" autocomplete="off" required>
              </div>
              <div>
                <label class="business-field-label" for="businessIdNumber">ID NUMBER</label>
                <input class="business-field-control" id="businessIdNumber" type="text" placeholder="ID number" autocomplete="off" required>
              </div>
            </div>
          </section>

          <section class="business-client-form-section" id="businessInfoSection">
            <div class="business-client-section-title"><span></span>${salaryFieldIcon('work')}<b>BUSINESS INFORMATION</b></div>

            <label class="business-field-label" for="businessName">BUSINESS NAME</label>
            <input class="business-field-control" id="businessName" type="text" autocomplete="organization" required>

            <div class="business-two-col">
              <div>
                <label class="business-field-label" for="businessIndustry">BUSINESS TYPE / INDUSTRY</label>
                <input class="business-field-control" id="businessIndustry" type="text" autocomplete="organization-title">
              </div>
              <div>
                <label class="business-field-label" for="businessYears">YEARS IN OPERATION</label>
                <input class="business-field-control" id="businessYears" type="number" min="0" step="1" value="0" inputmode="numeric">
              </div>
            </div>

            <label class="business-field-label" for="businessAddress">BUSINESS ADDRESS</label>
            <div class="business-input-with-icon business-full-width"><span>${salaryFieldIcon('pin')}</span><input class="business-field-control" id="businessAddress" type="text" autocomplete="street-address"></div>

            <div class="business-two-col">
              <div>
                <label class="business-field-label" for="businessPermit">DTI / SEC / PERMIT NO.</label>
                <input class="business-field-control" id="businessPermit" type="text" autocomplete="off">
              </div>
              <div>
                <label class="business-field-label" for="businessMonthlyIncome">AVG. MONTHLY INCOME (₱)</label>
                <input class="business-field-control" id="businessMonthlyIncome" type="number" min="0" step="0.01" value="0.00" inputmode="decimal">
              </div>
            </div>
          </section>

          <section class="business-client-form-section business-loan-purpose-section" id="businessLoanPurposeSection">
            <div class="business-client-section-title"><span></span>${salaryFieldIcon('id')}<b>LOAN PURPOSE</b></div>

            <label class="business-field-label" for="businessLoanPurpose">PURPOSE OF LOAN</label>
            <textarea class="business-field-control business-textarea" id="businessLoanPurpose" rows="4"></textarea>

            <label class="business-field-label" for="businessRepaymentSource">SOURCE OF REPAYMENT</label>
            <input class="business-field-control" id="businessRepaymentSource" type="text">
          </section>

          <div id="businessClientFormError" class="business-client-form-error" role="alert" aria-live="polite"></div>
        </div>
      </div>

      <div class="business-client-modal-footer">
        <button class="business-client-cancel" type="button" onclick="closeModal()">Cancel</button>
        <button class="business-client-save" id="businessClientSaveBtn" type="button" onclick="saveBusinessClient()">◉ &nbsp; ${EDITING_CLIENT_ID ? 'Save Changes' : 'Save Client'}</button>
      </div>
    </div>
  `, 'business-client-form-modal');

  const scroller = document.getElementById('businessClientFormScroll');
  if (scroller) scroller.addEventListener('scroll', updateBusinessActiveSection, { passive: true });
  if (existing) {
    const values = { businessOwnerName: existing.name || '', businessOwnerContact: existing.contact || '', businessOwnerAddress: existing.address || '', businessIdType: existingDetails.idType || '', businessIdNumber: existingDetails.idNumber || '', businessName: existingDetails.businessName || '', businessIndustry: existingDetails.industry || '', businessYears: existingDetails.yearsInOperation ?? 0, businessAddress: existingDetails.businessAddress || '', businessPermit: existingDetails.permitNumber || '', businessMonthlyIncome: existingDetails.monthlyIncome ?? 0, businessLoanPurpose: existingDetails.loanPurpose || '', businessRepaymentSource: existingDetails.repaymentSource || '' };
    Object.entries(values).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value; });
  }
}

function focusBusinessSection(sectionId) {
  const section = document.getElementById(sectionId);
  const scroller = document.getElementById('businessClientFormScroll');
  if (!section || !scroller) return;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('.business-client-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === sectionId);
  });
}

function updateBusinessActiveSection() {
  const scroller = document.getElementById('businessClientFormScroll');
  if (!scroller) return;
  const sections = [...document.querySelectorAll('.business-client-form-section')];
  let active = sections[0]?.id;
  const marker = scroller.scrollTop + 70;
  sections.forEach(section => { if (section.offsetTop <= marker) active = section.id; });
  document.querySelectorAll('.business-client-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === active);
  });
}

async function saveBusinessClient() {
  const fields = {
    name: document.getElementById('businessOwnerName')?.value.trim() || '',
    contactNumber: document.getElementById('businessOwnerContact')?.value.trim() || '',
    address: document.getElementById('businessOwnerAddress')?.value.trim() || '',
    idType: document.getElementById('businessIdType')?.value.trim() || '',
    idNumber: document.getElementById('businessIdNumber')?.value.trim() || '',
    businessName: document.getElementById('businessName')?.value.trim() || '',
    industry: document.getElementById('businessIndustry')?.value.trim() || '',
    yearsInOperation: Number(document.getElementById('businessYears')?.value || 0),
    businessAddress: document.getElementById('businessAddress')?.value.trim() || '',
    permitNumber: document.getElementById('businessPermit')?.value.trim() || '',
    monthlyIncome: Number(document.getElementById('businessMonthlyIncome')?.value || 0),
    loanPurpose: document.getElementById('businessLoanPurpose')?.value.trim() || '',
    repaymentSource: document.getElementById('businessRepaymentSource')?.value.trim() || ''
  };
  const error = document.getElementById('businessClientFormError');
  const btn = document.getElementById('businessClientSaveBtn');
  const showError = (message, section) => {
    if (error) { error.textContent = message; error.classList.add('show'); }
    if (section) focusBusinessSection(section);
  };

  if (!fields.name || !fields.contactNumber || !fields.address || !fields.idType || !fields.idNumber) {
    showError('Please complete the required owner information fields.', 'businessOwnerSection');
    return;
  }
  if (!/^[-+() 0-9]{7,20}$/.test(fields.contactNumber)) {
    showError('Please enter a valid contact number.', 'businessOwnerSection');
    return;
  }
  if (!fields.businessName) {
    showError('Please enter the business name.', 'businessInfoSection');
    return;
  }
  if (fields.yearsInOperation < 0 || !Number.isFinite(fields.yearsInOperation)) {
    showError('Years in operation must be a valid non-negative number.', 'businessInfoSection');
    return;
  }
  if (fields.monthlyIncome < 0 || Number.isNaN(fields.monthlyIncome)) {
    showError('Average monthly income must be a valid non-negative amount.', 'businessInfoSection');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  if (error) error.classList.remove('show');

  try {
    const payload = { name: fields.name, address: fields.address, contactNumber: fields.contactNumber, type: 'Business Loan' };
    const savedId = EDITING_CLIENT_ID;
    if (savedId) await api.put(`/clients/${encodeURIComponent(savedId)}`, payload);
    else { const created = await api.post('/clients', payload); EDITING_CLIENT_ID = created?.id ? String(created.id) : null; }
    saveBusinessClientDetails(savedId || EDITING_CLIENT_ID, {
      idType: fields.idType,
      idNumber: fields.idNumber,
      businessName: fields.businessName,
      industry: fields.industry,
      yearsInOperation: fields.yearsInOperation,
      businessAddress: fields.businessAddress,
      permitNumber: fields.permitNumber,
      monthlyIncome: fields.monthlyIncome,
      loanPurpose: fields.loanPurpose,
      repaymentSource: fields.repaymentSource
    });
    closeModal();
    await loadAllFromApi();
    renderAll();
    showView('clients');
    alert(savedId ? 'Business client updated successfully.' : 'Business client added successfully.');
    EDITING_CLIENT_ID = null;
  } catch (err) {
    if (error) { error.textContent = err.message || 'Could not save client.'; error.classList.add('show'); }
    if (btn) { btn.disabled = false; btn.textContent = '◉  Save Client'; }
  }
}

function openSalaryClientForm(clientId = null) {
  PENDING_CLIENT_LOAN_TYPE = 'Salary Loan';
  EDITING_CLIENT_ID = clientId ? String(clientId) : null;
  const existing = clientId ? DATA.clients.find(c => String(c.id) === String(clientId)) : null;
  const existingDetails = existing ? (getSalaryClientDetailsStore()[existing.id] || {}) : {};
  openModal(`
    <div class="salary-client-modal">
      <div class="salary-client-modal-header">
        <div class="salary-client-header-left">
          <span class="salary-client-header-icon">${loanTypeIconSvg('Salary Loan')}</span>
          <div>
            <div class="salary-client-kicker">SALARY / INDIVIDUAL</div>
            <h2>Add New Client</h2>
          </div>
        </div>
        <button class="salary-client-close" type="button" onclick="closeModal()" aria-label="Close">×</button>
      </div>

      <div class="salary-client-modal-main">
        <aside class="salary-client-nav" aria-label="Client form navigation">
          <div class="salary-client-nav-label">NAVIGATE</div>
          <button type="button" class="salary-client-nav-item active" data-section="salaryPersonalSection" onclick="focusSalarySection('salaryPersonalSection')">
            <span>${salaryFieldIcon('person')}</span><b>Personal Info</b>
          </button>
          <button type="button" class="salary-client-nav-item" data-section="salaryEmploymentSection" onclick="focusSalarySection('salaryEmploymentSection')">
            <span>${salaryFieldIcon('work')}</span><b>Employment Info</b>
          </button>
        </aside>

        <div class="salary-client-form-scroll" id="salaryClientFormScroll">
          <section class="salary-client-form-section" id="salaryPersonalSection">
            <div class="salary-client-section-title"><span></span>${salaryFieldIcon('person')}<b>PERSONAL INFORMATION</b></div>

            <label class="salary-field-label" for="salaryName">FULL NAME</label>
            <input class="salary-field-control" id="salaryName" type="text" autocomplete="name" required>

            <label class="salary-field-label" for="salaryContact">CONTACT NUMBER</label>
            <div class="salary-input-with-icon"><span>${salaryFieldIcon('phone')}</span><input class="salary-field-control" id="salaryContact" type="tel" inputmode="tel" placeholder="09XX XXX XXXX" autocomplete="tel" required></div>

            <label class="salary-field-label" for="salaryAddress">ADDRESS</label>
            <div class="salary-input-with-icon salary-full-width"><span>${salaryFieldIcon('pin')}</span><input class="salary-field-control" id="salaryAddress" type="text" autocomplete="street-address" required></div>

            <div class="salary-two-col">
              <div>
                <label class="salary-field-label" for="salaryIdType">VALID ID TYPE</label>
                <input class="salary-field-control" id="salaryIdType" type="text" autocomplete="off" required>
              </div>
              <div>
                <label class="salary-field-label" for="salaryIdNumber">ID NUMBER</label>
                <input class="salary-field-control" id="salaryIdNumber" type="text" placeholder="ID number" autocomplete="off" required>
              </div>
            </div>
          </section>

          <section class="salary-client-form-section salary-employment-section" id="salaryEmploymentSection">
            <div class="salary-client-section-title"><span></span>${salaryFieldIcon('work')}<b>EMPLOYMENT INFORMATION</b></div>

            <label class="salary-field-label" for="salaryCompanyName">COMPANY NAME</label>
            <input class="salary-field-control" id="salaryCompanyName" type="text" autocomplete="organization">

            <div class="salary-two-col">
              <div>
                <label class="salary-field-label" for="salaryEmploymentStatus">EMPLOYMENT STATUS</label>
                <select class="salary-field-control" id="salaryEmploymentStatus">
                  <option value="Regular">Regular</option>
                  <option value="Probationary">Probationary</option>
                  <option value="Contractual">Contractual</option>
                  <option value="Part-time">Part-time</option>
                  <option value="Self-employed">Self-employed</option>
                </select>
              </div>
              <div>
                <label class="salary-field-label" for="salaryDateHired">DATE HIRED</label>
                <input class="salary-field-control salary-date-control" id="salaryDateHired" type="date">
              </div>
            </div>

            <div class="salary-two-col">
              <div>
                <label class="salary-field-label" for="salaryMonthlySalary">MONTHLY SALARY (₱)</label>
                <input class="salary-field-control" id="salaryMonthlySalary" type="number" min="0" step="0.01" value="0.00" inputmode="decimal">
              </div>
              <div>
                <label class="salary-field-label" for="salaryEmployerContact">EMPLOYER CONTACT</label>
                <div class="salary-input-with-icon"><span>${salaryFieldIcon('phone')}</span><input class="salary-field-control" id="salaryEmployerContact" type="tel" inputmode="tel" placeholder="09XX XXX XXXX" autocomplete="tel"></div>
              </div>
            </div>
          </section>

          <div id="salaryClientFormError" class="salary-client-form-error" role="alert" aria-live="polite"></div>
        </div>
      </div>

      <div class="salary-client-modal-footer">
        <button class="salary-client-cancel" type="button" onclick="closeModal()">Cancel</button>
        <button class="salary-client-save" id="salaryClientSaveBtn" type="button" onclick="saveSalaryClient()">◉ &nbsp; ${EDITING_CLIENT_ID ? 'Save Changes' : 'Save Client'}</button>
      </div>
    </div>
  `, 'salary-client-form-modal');

  const scroller = document.getElementById('salaryClientFormScroll');
  if (scroller) {
    scroller.addEventListener('scroll', updateSalaryActiveSection, { passive: true });
  }
  if (existing) {
    const values = { salaryName: existing.name || '', salaryContact: existing.contact || '', salaryAddress: existing.address || '', salaryIdType: existingDetails.idType || '', salaryIdNumber: existingDetails.idNumber || '', salaryCompanyName: existingDetails.companyName || '', salaryEmploymentStatus: existingDetails.employmentStatus || 'Regular', salaryDateHired: existingDetails.dateHired || '', salaryMonthlySalary: existingDetails.monthlySalary ?? 0, salaryEmployerContact: existingDetails.employerContact || '' };
    Object.entries(values).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value; });
  }
}

function focusSalarySection(sectionId) {
  const section = document.getElementById(sectionId);
  const scroller = document.getElementById('salaryClientFormScroll');
  if (!section || !scroller) return;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('.salary-client-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === sectionId);
  });
}

function updateSalaryActiveSection() {
  const scroller = document.getElementById('salaryClientFormScroll');
  if (!scroller) return;
  const sections = [...document.querySelectorAll('.salary-client-form-section')];
  let active = sections[0]?.id;
  const marker = scroller.scrollTop + 70;
  sections.forEach(section => {
    if (section.offsetTop <= marker) active = section.id;
  });
  document.querySelectorAll('.salary-client-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === active);
  });
}

async function saveSalaryClient() {
  const fields = {
    name: document.getElementById('salaryName')?.value.trim() || '',
    contactNumber: document.getElementById('salaryContact')?.value.trim() || '',
    address: document.getElementById('salaryAddress')?.value.trim() || '',
    idType: document.getElementById('salaryIdType')?.value.trim() || '',
    idNumber: document.getElementById('salaryIdNumber')?.value.trim() || '',
    companyName: document.getElementById('salaryCompanyName')?.value.trim() || '',
    employmentStatus: document.getElementById('salaryEmploymentStatus')?.value || 'Regular',
    dateHired: document.getElementById('salaryDateHired')?.value || '',
    monthlySalary: Number(document.getElementById('salaryMonthlySalary')?.value || 0),
    employerContact: document.getElementById('salaryEmployerContact')?.value.trim() || ''
  };
  const error = document.getElementById('salaryClientFormError');
  const btn = document.getElementById('salaryClientSaveBtn');
  if (!fields.name || !fields.contactNumber || !fields.address || !fields.idType || !fields.idNumber) {
    if (error) { error.textContent = 'Please complete the required personal information fields.'; error.classList.add('show'); }
    focusSalarySection('salaryPersonalSection');
    return;
  }
  if (!/^[-+() 0-9]{7,20}$/.test(fields.contactNumber)) {
    if (error) { error.textContent = 'Please enter a valid contact number.'; error.classList.add('show'); }
    focusSalarySection('salaryPersonalSection');
    return;
  }
  if (fields.monthlySalary < 0 || Number.isNaN(fields.monthlySalary)) {
    if (error) { error.textContent = 'Monthly salary must be a valid non-negative amount.'; error.classList.add('show'); }
    focusSalarySection('salaryEmploymentSection');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  if (error) error.classList.remove('show');

  try {
    const payload = { name: fields.name, address: fields.address, contactNumber: fields.contactNumber, type: 'Salary Loan' };
    const savedId = EDITING_CLIENT_ID;
    if (savedId) await api.put(`/clients/${encodeURIComponent(savedId)}`, payload);
    else { const created = await api.post('/clients', payload); EDITING_CLIENT_ID = created?.id ? String(created.id) : null; }
    saveSalaryClientDetails(savedId || EDITING_CLIENT_ID, {
      idType: fields.idType,
      idNumber: fields.idNumber,
      companyName: fields.companyName,
      employmentStatus: fields.employmentStatus,
      dateHired: fields.dateHired,
      monthlySalary: fields.monthlySalary,
      employerContact: fields.employerContact
    });
    closeModal();
    await loadAllFromApi();
    renderAll();
    showView('clients');
    alert(savedId ? 'Salary client updated successfully.' : 'Salary client added successfully.');
    EDITING_CLIENT_ID = null;
  } catch (err) {
    if (error) { error.textContent = err.message || 'Could not save client.'; error.classList.add('show'); }
    if (btn) { btn.disabled = false; btn.textContent = '◉  Save Client'; }
  }
}

function openClientModal() {
  EDITING_CLIENT_ID = null;
  PENDING_CLIENT_LOAN_TYPE = null;
  const options = [
    { type: 'Salary Loan', subtitle: 'For employed individuals', cls: 'salary' },
    { type: 'Business Loan', subtitle: 'For business owners', cls: 'business' },
    { type: 'Group Loan', subtitle: 'For community groups', cls: 'group' }
  ];

  openModal(`
    <div class="client-loan-type-modal">
      <div class="client-loan-type-header">
        <h2>Select Loan Type</h2>
        <button class="client-loan-type-close" type="button" onclick="closeModal()" aria-label="Close">×</button>
      </div>
      <div class="client-loan-type-list" role="listbox" aria-label="Loan type">
        ${options.map(o => `
          <button class="client-loan-type-option" type="button" data-loan-type="${o.type}" aria-selected="false" onclick="selectClientLoanType('${o.type}')">
            <span class="client-loan-type-icon ${o.cls}">${loanTypeIconSvg(o.type)}</span>
            <span class="client-loan-type-copy"><strong>${o.type}</strong><small>${o.subtitle}</small></span>
            <span class="client-loan-type-arrow" aria-hidden="true">›</span>
          </button>
        `).join('')}
      </div>
    </div>
  `, 'client-loan-type-modal-shell');
}
async function saveClient() {
  // Backward-compatible entry point. New client creation uses the
  // loan-type-specific forms; Salary Loan is the currently implemented form.
  return saveSalaryClient();
}

async function deleteClient(clientId) {
  const client = DATA.clients.find(c => c.id === clientId);
  if (!client) {
    alert('Client not found.');
    return;
  }

  const loans = getClientLoans(clientId).filter(l => l.status !== 'rejected');
  const outstanding = computeClientOutstanding(clientId);
  const confirmed = window.confirm(
    `Delete ${client.name}?\n\n` +
    `This permanently removes the client record from the system.\n` +
    `The backend will prevent deletion while the client has an active or unpaid loan.\n\n` +
    `Loans on record: ${loans.length}\n` +
    `Outstanding balance: ${peso(outstanding)}\n\n` +
    `Click OK only if you are certain you want to permanently delete this client.`
  );
  if (!confirmed) return;

  try {
    await api.del(`/clients/${encodeURIComponent(clientId)}`);
    await loadAllFromApi();
    renderAll();
    alert(`${client.name} was permanently deleted.`);
  } catch (err) {
    alert(`Client was not deleted.\n\n${err.message}`);
  }
}

/* ====================== CLIENT PROFILE ====================== */
let ACTIVE_CLIENT_PROFILE_ID = null;

function getClientDetails(client) {
  const type = normalizedClientLoanType(client?.type);
  if (type === 'Business Loan') return getBusinessClientDetailsStore()[client.id] || {};
  if (type === 'Salary Loan') return getSalaryClientDetailsStore()[client.id] || {};
  return getGroupClientDetailsStore()[client.id] || {};
}

function openClientProfile(clientId) {
  if (!DATA.clients.some(c => c.id === clientId)) { alert('Client not found.'); return; }
  ACTIVE_CLIENT_PROFILE_ID = clientId;
  showView('clientProfile');
}

function profileLoanSummaryHtml(loan, clientId) {
  if (!loan) return '<div class="client-profile-empty">No active loan record.</div>';
  const calc = loanCalc(loan);
  const bucket = scheduleBucket(loan);
  const label = bucket === 'fully_paid' || calc.outstanding <= 0.009 ? 'Fully Paid' : dueLabel(loan);
  return `<div class="profile-loan-panel">
    <div class="profile-loan-main"><b>${escapeHtml(loan.type || 'Loan')}</b><span>· ${escapeHtml(loan.refId || '—')}</span></div>
    <div class="profile-loan-values"><span>Principal: <b>${peso(loan.principal || 0)}</b></span><span>Balance: <b>${peso(Math.max(0, calc.outstanding || 0))}</b></span></div>
    <span class="client-status-pill ${bucket === 'fully_paid' ? 'inactive' : 'active'}"><i></i> ${escapeHtml(label)}</span>
    <button type="button" class="profile-loan-link" onclick="showView('loandesk'); setTimeout(()=>viewLoanDetails('${escapeJs(loan.id || '')}'),0)">View in Loan Desk →</button>
  </div>`;
}

function renderClientProfile(clientId) {
  const client = DATA.clients.find(c => c.id === clientId);
  const root = document.getElementById('clientProfileBody');
  if (!client || !root) return;
  const loans = getClientLoans(clientId).filter(l => l.status !== 'rejected');
  const activeLoan = loans.find(l => !['fully_paid','rejected'].includes(String(l.status || '').toLowerCase())) || loans[0];
  const details = getClientDetails(client);
  const type = normalizedClientLoanType(client.type);
  const blacklisted = isClientBlacklisted(clientId);
  const iconClass = type.toLowerCase().includes('business') ? 'business' : type.toLowerCase().includes('group') ? 'group' : 'salary';
  const status = clientDisplayStatus(client);

  let body = '';
  if (type === 'Business Loan') {
    body = `<section class="client-profile-section">
      <div class="client-profile-section-head">${salaryFieldIcon('person')} <b>PERSONAL INFORMATION</b></div>
      <div class="client-profile-fields">
        <div><span>FULL NAME</span><b>${escapeHtml(client.name || '—')}</b></div>
        <div><span>CONTACT NUMBER</span><b>${escapeHtml(client.contact || '—')}</b></div>
        <div><span>VALID ID TYPE</span><b>${escapeHtml(details.idType || '—')}</b></div>
        <div class="wide"><span>ADDRESS</span><b>${escapeHtml(client.address || '—')}</b></div>
        <div><span>ID NUMBER</span><b>${escapeHtml(details.idNumber || '—')}</b></div>
      </div>
    </section>
    <section class="client-profile-section">
      <div class="client-profile-section-head">${salaryFieldIcon('work')} <b>BUSINESS INFORMATION</b></div>
      <div class="client-profile-fields">
        <div><span>BUSINESS NAME</span><b>${escapeHtml(details.businessName || '—')}</b></div>
        <div><span>INDUSTRY / TYPE</span><b>${escapeHtml(details.industry || '—')}</b></div>
        <div><span>YEARS IN OPERATION</span><b>${details.yearsInOperation ?? '—'}</b></div>
        <div class="wide"><span>BUSINESS ADDRESS</span><b>${escapeHtml(details.businessAddress || '—')}</b></div>
        <div><span>DTI / SEC / PERMIT NO.</span><b>${escapeHtml(details.permitNumber || '—')}</b></div>
        <div><span>AVG. MONTHLY INCOME</span><b>${details.monthlyIncome != null ? peso(details.monthlyIncome) : '—'}</b></div>
      </div>
    </section>`;
  } else if (type === 'Salary Loan') {
    body = `<section class="client-profile-section">
      <div class="client-profile-section-head">${salaryFieldIcon('person')} <b>PERSONAL INFORMATION</b></div>
      <div class="client-profile-fields">
        <div><span>FULL NAME</span><b>${escapeHtml(client.name || '—')}</b></div>
        <div><span>CONTACT NUMBER</span><b>${escapeHtml(client.contact || '—')}</b></div>
        <div><span>VALID ID TYPE</span><b>${escapeHtml(details.idType || '—')}</b></div>
        <div class="wide"><span>ADDRESS</span><b>${escapeHtml(client.address || '—')}</b></div>
        <div><span>ID NUMBER</span><b>${escapeHtml(details.idNumber || '—')}</b></div>
      </div>
    </section>
    <section class="client-profile-section">
      <div class="client-profile-section-head">${salaryFieldIcon('work')} <b>EMPLOYMENT INFORMATION</b></div>
      <div class="client-profile-fields">
        <div><span>COMPANY NAME</span><b>${escapeHtml(details.companyName || '—')}</b></div>
        <div><span>EMPLOYMENT STATUS</span><b>${escapeHtml(details.employmentStatus || '—')}</b></div>
        <div><span>DATE HIRED</span><b>${details.dateHired ? formatDate(details.dateHired) : '—'}</b></div>
        <div><span>MONTHLY SALARY</span><b>${details.monthlySalary != null ? peso(details.monthlySalary) : '—'}</b></div>
        <div><span>EMPLOYER CONTACT</span><b>${escapeHtml(details.employerContact || '—')}</b></div>
      </div>
    </section>`;
  } else {
    const members = Array.isArray(details.members) ? details.members : [];
    body = `<section class="client-profile-section">
      <div class="client-profile-section-head">${salaryFieldIcon('person')} <b>GROUP INFORMATION</b></div>
      <div class="client-profile-fields">
        <div><span>GROUP NAME</span><b>${escapeHtml(details.groupName || client.name || '—')}</b></div>
        <div><span>GROUP LEADER</span><b>${escapeHtml(members.find(m => m.role === 'Leader')?.name || '—')}</b></div>
        <div><span>LEADER CONTACT</span><b>${escapeHtml(members.find(m => m.role === 'Leader')?.contact || '—')}</b></div>
        <div><span>TOTAL MEMBERS</span><b>${members.length}</b></div>
      </div>
    </section>
    <section class="client-profile-section">
      <div class="client-profile-section-head">${loanTypeIconSvg('Group Loan')} <b>MEMBERS</b></div>
      <div class="client-profile-members">${members.map((m,i)=>`<div class="client-profile-member"><span>${i+1}</span><div><b>${escapeHtml(m.name || `Member ${i+1}`)}</b><small>${escapeHtml(m.role || 'Member')} · ${escapeHtml(m.contact || '—')}</small></div></div>`).join('') || '<div class="client-profile-empty">No member details saved.</div>'}</div>
    </section>`;
  }

  root.innerHTML = `
    <div class="client-profile-page">
      <button class="profile-back-btn" onclick="ACTIVE_CLIENT_PROFILE_ID=null; showView('clients')">‹ &nbsp; Back to Client Registry</button>
      <div class="client-profile-hero">
        <div class="client-profile-hero-left">
          <span class="client-profile-type-icon ${iconClass}">${loanTypeIconSvg(type)}</span>
          <div><div class="profile-client-name-row"><h2>${escapeHtml(client.name || '—')}</h2>${clientStatusPill(status)}</div><div class="profile-client-meta">${escapeHtml(client.id || '—')} &nbsp;·&nbsp; ${escapeHtml(type)}</div></div>
        </div>
        <div class="client-profile-hero-actions">
          <button type="button" class="profile-block-btn ${blacklisted ? 'is-blocked' : ''}" onclick="toggleClientBlacklist('${escapeJs(client.id)}')">▣ &nbsp;${blacklisted ? 'Unblock' : 'Blacklist'}</button>
          <button type="button" class="profile-edit-primary" onclick="editClient('${escapeJs(client.id)}')">⌕ &nbsp; Edit Client</button>
        </div>
      </div>
      <div class="client-profile-content">${body}</div>
      <div class="client-profile-bottom-grid">
        <section class="client-profile-card-mini"><div class="client-profile-section-head">▱ <b>ACTIVE LOAN</b></div>${profileLoanSummaryHtml(activeLoan, clientId)}</section>
        <section class="client-profile-card-mini"><div class="client-profile-section-head">▣ <b>SAVINGS / CAPITAL BUILD-UP</b></div><div class="profile-savings-box"><span>CURRENT BALANCE</span><b>₱${Number(client.savingsBalance || details.savings || 3500).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</b></div><small class="profile-registered">Registered: ${formatDate(client.registrationDate)}</small></section>
      </div>
    </div>`;
}

function toggleClientBlacklist(clientId) {
  const client = DATA.clients.find(c => c.id === clientId);
  if (!client) return;
  const next = !isClientBlacklisted(clientId);
  const message = next ? `Blacklist ${client.name}?\n\nThis will move the client to the Blacklisted list.` : `Remove ${client.name} from the Blacklisted list?`;
  if (!window.confirm(message)) return;
  setClientBlacklisted(clientId, next);
  renderAll();
  showView('clientProfile');
  alert(next ? `${client.name} is now blacklisted.` : `${client.name} was removed from the Blacklisted list.`);
}

function openLedger(clientId) { openClientProfile(clientId); }

function editClient(clientId) {
  const client = DATA.clients.find(c => c.id === clientId);
  if (!client) { alert('Client not found.'); return; }
  const type = normalizedClientLoanType(client.type);
  if (type === 'Business Loan') return openBusinessClientForm(clientId);
  if (type === 'Group Loan') return openGroupClientForm(clientId);
  return openSalaryClientForm(clientId);
}

async function saveClientEdit(clientId) {
  const name = document.getElementById('ecName')?.value.trim();
  const address = document.getElementById('ecAddress')?.value.trim();
  const contactNumber = document.getElementById('ecContact')?.value.trim();
  const type = document.getElementById('ecType')?.value;
  const error = document.getElementById('ecError');
  const btn = document.getElementById('ecSaveBtn');
  if (!name || !address || !contactNumber || !type) {
    if (error) { error.textContent = 'Name, address, contact number, and loan classification are required.'; error.classList.add('show'); }
    return;
  }
  if (!/^[-+() 0-9]{7,20}$/.test(contactNumber)) {
    if (error) { error.textContent = 'Please enter a valid contact number.'; error.classList.add('show'); }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    await api.put(`/clients/${encodeURIComponent(clientId)}`, { name, address, contactNumber, type });
    closeModal();
    await loadAllFromApi();
    renderAll();
    ACTIVE_CLIENT_PROFILE_ID = clientId;
    showView('clientProfile');
    alert('Client updated successfully.');
  } catch (err) {
    if (error) { error.textContent = err.message || 'Could not update client.'; error.classList.add('show'); }
    if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
  }
}

document.getElementById('backToClients').addEventListener('click', () => { ACTIVE_CLIENT_PROFILE_ID = null; showView('clients'); });

/* ====================== LOAN DESK ====================== */
let currentLoanTab = 'all';
document.querySelectorAll('#loanTabs .loan-tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('#loanTabs .loan-tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  currentLoanTab = t.dataset.tab;
  renderLoanDesk();
}));

document.getElementById('loanSearch').addEventListener('input', renderLoanDesk);

function shortLoanId(value) {
  const text = String(value || '');
  const match = text.match(/(\d{2}-?\d{4})$/);
  return match ? match[1].replace(/-/g, '-') : text;
}

function shortLoanType(value) {
  const t = String(value || '').toLowerCase();
  if (t.includes('business')) return 'Business';
  if (t.includes('salary') || t.includes('individual')) return 'Salary';
  if (t.includes('group')) return 'Group';
  return String(value || '—').replace(/\s+loan$/i, '');
}

function loanTypeClass(value) {
  const t = String(value || '').toLowerCase();
  if (t.includes('business')) return 'business';
  if (t.includes('salary') || t.includes('individual')) return 'salary';
  if (t.includes('group')) return 'group';
  return 'other';
}

function renderLoanDesk() {
  const search = (document.getElementById('loanSearch').value || '').trim().toLowerCase();
  const allLoans = [...DATA.loans];
  const activePortfolio = allLoans.filter(l => !['rejected', 'fully_paid', 'application'].includes(String(l.status || '').toLowerCase()));
  const fullyPaidLoans = allLoans.filter(l => String(l.status || '').toLowerCase() === 'fully_paid' || loanCalc(l).outstanding <= 0.009);

  let source = currentLoanTab === 'fully_paid' ? fullyPaidLoans : activePortfolio;

  source = source.filter(l => {
    const q = `${l.clientName || ''} ${l.refId || ''} ${l.type || ''}`.toLowerCase();
    if (search && !q.includes(search)) return false;

    if (currentLoanTab === 'all') return true;
    if (currentLoanTab === 'current') return ['current', 'partial_payment', 'upcoming'].includes(scheduleBucket(l));
    if (currentLoanTab === 'due_today') return scheduleBucket(l) === 'due_today';
    if (currentLoanTab === 'past_due') return scheduleBucket(l) === 'past_due';
    if (currentLoanTab === 'fully_paid') return true;
    return true;
  });

  const released = activePortfolio.reduce((s, l) => s + Number(l.principal || 0), 0);
  const repaid = activePayments().reduce((s, p) => s + Number(p.amount || 0), 0);
  const outstanding = activePortfolio.reduce((s, l) => s + Math.max(0, Number(loanCalc(l).outstanding || 0)), 0);

  document.getElementById('loanDeskStats').innerHTML = `
    <div class="loan-strip-stat">
      <div class="loan-strip-icon released">▣</div>
      <div><span>TOTAL RELEASED PRINCIPAL</span><b>${peso(released)}</b></div>
    </div>
    <div class="loan-strip-stat">
      <div class="loan-strip-icon repaid">✓</div>
      <div><span>TOTAL REPAID</span><b>${peso(repaid)}</b></div>
    </div>
    <div class="loan-strip-stat">
      <div class="loan-strip-icon outstanding">$</div>
      <div><span>TOTAL OUTSTANDING</span><b>${peso(outstanding)}</b></div>
    </div>`;

  const recordCount = document.querySelector('#view-loandesk .loan-list-count');
  if (recordCount) recordCount.textContent = `Total: ${source.length}`;

  document.getElementById('loansTableBody').innerHTML = source.map(l => {
    const calc = loanCalc(l);
    const bucket = currentLoanTab === 'fully_paid' ? 'fully_paid' : scheduleBucket(l);
    const label = currentLoanTab === 'fully_paid' ? 'Fully Paid' : dueLabel(l);
    return `<tr>
      <td><span class="loan-id-text">${escapeHtml(shortLoanId(l.refId || l.id || '—'))}</span></td>
      <td><b class="loan-client-name">${escapeHtml(l.clientName || '—')}</b></td>
      <td><span class="loan-type-pill ${loanTypeClass(l.type)}">${escapeHtml(shortLoanType(l.type || '—'))}</span></td>
      <td class="money loan-outstanding-cell">${peso(Math.max(0, calc.outstanding || 0))}</td>
      <td><span class="loan-status-pill ${bucket}">${escapeHtml(label)}</span></td>
      <td>
        <div class="loan-action-group">
          <button class="loan-action view" type="button" title="View loan details" onclick="viewLoanDetails('${escapeJs(l.id || '')}')">◉ <span>View</span></button>
          ${bucket === 'fully_paid' ? '' : `<button class="loan-action payment" type="button" title="Open Collections for this loan" onclick="collectLoan('${escapeJs(l.id || '')}')">₱ <span>Payment</span></button>`}
        </div>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="6"><div class="empty-state">No loans in this category.</div></td></tr>`;
}

function showLoanEditMessage(encodedRefId) {
  const refId = decodeURIComponent(encodedRefId || '');
  alert(`Loan ${refId || ''} cannot be edited after release. Released loans remain protected for audit purposes.`);
}

let ACTIVE_LOAN_DETAIL_ID = null;

function loanPaymentFrequency(loan) {
  const raw = String(loan.paymentFrequency || loan.frequency || loan.paymentSchedule || '').trim();
  if (raw) return raw;
  const type = String(loan.type || '').toLowerCase();
  if (type.includes('business')) return 'Weekly';
  if (type.includes('group')) return 'Weekly';
  return 'Monthly';
}

function loanPaymentCount(loan) {
  const frequency = loanPaymentFrequency(loan).toLowerCase();
  const months = Math.max(1, Number(loan.term || 1));
  if (frequency.includes('week')) return Math.max(1, Math.round(months * 4));
  if (frequency.includes('semi')) return Math.max(1, Math.round(months * 2));
  return months;
}

function loanAmortization(loan, calc) {
  const explicit = Number(loan.monthlyAmortization || 0);
  if (explicit > 0) {
    const frequency = loanPaymentFrequency(loan).toLowerCase();
    if (frequency.includes('week')) return calc.totalReceivable / loanPaymentCount(loan);
    return explicit;
  }
  const count = loanPaymentCount(loan);
  return count > 0 ? calc.totalReceivable / count : 0;
}

function clientExtendedDetails(client) {
  const id = String(client?.id || '');
  const type = normalizedClientLoanType(client?.type);
  try {
    if (type === 'Business Loan') return getBusinessClientDetailsStore()[id] || {};
    if (type === 'Group Loan') return getGroupClientDetailsStore()[id] || {};
    return getSalaryClientDetailsStore()[id] || {};
  } catch (_) { return {}; }
}

function paymentProgressForLoan(loan, calc) {
  const total = Math.max(0, Number(calc.totalReceivable || 0));
  const collected = Math.max(0, Number(calc.totalCollection || 0));
  const percent = total > 0 ? Math.min(100, Math.max(0, collected / total * 100)) : 0;
  return { total, collected, outstanding: Math.max(0, Number(calc.outstanding || 0)), percent };
}

function renderLoanDetail(id) {
  const loan = DATA.loans.find(l => String(l.id) === String(id));
  const root = document.getElementById('loanDetailBody');
  if (!root) return;
  if (!loan) {
    root.innerHTML = `<div class="empty-state">Loan record could not be found.</div>`;
    return;
  }

  const calc = loanCalc(loan);
  const client = DATA.clients.find(c => String(c.id) === String(loan.clientId)) || {};
  const details = clientExtendedDetails(client);
  const progress = paymentProgressForLoan(loan, calc);
  const fullyPaid = progress.outstanding <= 0.009 || String(loan.status).toLowerCase() === 'fully_paid';
  const bucket = fullyPaid ? 'fully_paid' : scheduleBucket(loan);
  const statusLabel = fullyPaid ? 'Fully Paid' : dueLabel(loan);
  const frequency = loanPaymentFrequency(loan);
  const paymentCount = loanPaymentCount(loan);
  const amortization = loanAmortization(loan, calc);
  const maturity = loanDueDate(loan);
  const penaltyRate = Number(DATA.settings.penaltyRate || 0);
  const grace = Number(DATA.settings.gracePeriod || 0);
  const loanPayments = activePayments().filter(p => String(p.loanId) === String(loan.id));
  const latestPayment = loanPayments.length ? loanPayments[loanPayments.length - 1] : null;
  const paymentPercent = progress.percent.toFixed(0);

  root.innerHTML = `
    <div class="loan-detail-shell">
      <div class="loan-detail-heading-row">
        <div class="loan-detail-heading-left">
          <button class="loan-detail-back" type="button" onclick="ACTIVE_LOAN_DETAIL_ID=null; showView('loandesk')" aria-label="Back to Loan Desk">←</button>
          <div>
            <div class="loan-detail-name-row">
              <h1>${escapeHtml(loan.clientName || client.name || '—')}</h1>
              <span class="loan-current-pill ${fullyPaid ? 'paid' : bucket}"><i></i> ${escapeHtml(statusLabel)}</span>
            </div>
            <div class="loan-detail-ref">${escapeHtml(shortLoanId(loan.refId || loan.id || '—'))} &nbsp;·&nbsp; ${escapeHtml(loan.type || 'Loan')}</div>
          </div>
        </div>
        <div class="loan-detail-actions">
          ${fullyPaid ? '' : `<button class="loan-detail-btn payment" type="button" onclick="collectLoan('${escapeJs(loan.id || '')}')">₱ &nbsp;Record Payment</button>`}
        </div>
      </div>

      <div class="loan-detail-summary-card">
        <div class="loan-summary-metric"><span>PRINCIPAL</span><b>${peso(loan.principal || 0)}</b></div>
        <div class="loan-summary-metric"><span>TOTAL PAYABLE</span><b>${peso(calc.totalReceivable || 0)}</b></div>
        <div class="loan-summary-metric collected"><span>COLLECTED</span><b>${peso(progress.collected)}</b></div>
        <div class="loan-summary-metric outstanding"><span>OUTSTANDING</span><b>${peso(progress.outstanding)}</b></div>
        <div class="loan-progress-row"><div class="loan-progress-track"><span style="width:${paymentPercent}%"></span></div><span>${paymentPercent}% collected</span></div>
      </div>

      <div class="loan-detail-card">
        <div class="loan-detail-tabs">
          <button class="loan-detail-tab active" type="button" data-loan-detail-tab="overview">▣ &nbsp; Loan Overview</button>
          <button class="loan-detail-tab" type="button" data-loan-detail-tab="schedule">▦ &nbsp; Payment Schedule &amp; Ledger</button>
        </div>
        <div class="loan-overview-panel" id="loanOverviewPanel">
          <div class="loan-overview-top-grid">
            <section class="loan-info-section borrower">
              <div class="loan-info-title">BORROWER INFORMATION <span>${escapeHtml(client.id || '—')}</span></div>
              <div class="loan-info-list">
                <div><label>NAME</label><b>${escapeHtml(client.name || loan.clientName || '—')}</b></div>
                <div><label>CONTACT</label><b>${escapeHtml(client.contact || '—')}</b></div>
                <div><label>ADDRESS</label><b>${escapeHtml(client.address || '—')}</b></div>
                <div><label>VALID ID</label><b>${escapeHtml(details.idType ? `${details.idType}${details.idNumber ? ' · ' + details.idNumber : ''}` : (details.idNumber || '—'))}</b></div>
                <div><label>REGISTERED</label><b>${formatDate(client.registrationDate)}</b></div>
              </div>
            </section>
            <section class="loan-info-section">
              <div class="loan-info-title">LOAN INFORMATION</div>
              <div class="loan-info-list">
                <div><label>TYPE</label><b>${escapeHtml(loan.type || '—')}</b></div>
                <div><label>INTEREST</label><b>${Number(loan.rate || 0)}% / month</b></div>
                <div><label>PAYMENT</label><b>${escapeHtml(frequency)}</b></div>
                <div><label>AMORTIZATION</label><b>${peso(amortization)} / ${escapeHtml(frequency.toLowerCase().includes('week') ? 'week' : 'period')}</b></div>
                <div><label>GRANTED</label><b>${formatDate(loan.startDate)}</b></div>
                <div><label>MATURITY</label><b>${formatDate(maturity)}</b></div>
                <div><label>PENALTY</label><b>${penaltyRate}% / period</b></div>
                <div><label>GRACE</label><b>${grace} day${grace === 1 ? '' : 's'}</b></div>
              </div>
            </section>
          </div>
          <div class="loan-overview-bottom-grid">
            <section class="loan-info-section payment-progress-section">
              <div class="loan-info-title">PAYMENT PROGRESS</div>
              <div class="loan-payment-progress-box">
                <div class="loan-progress-amount">${peso(progress.collected)}</div>
                <div class="loan-progress-caption">collected of ${peso(progress.total)}</div>
                <div class="loan-progress-track large"><span style="width:${paymentPercent}%"></span></div>
                <div class="loan-progress-foot"><span>${peso(progress.outstanding)} remaining</span><b>${paymentPercent}% paid</b></div>
              </div>
            </section>
            <section class="loan-info-section">
              <div class="loan-info-title">SCHEDULE SUMMARY</div>
              <div class="loan-schedule-summary">
                <div><span>Terms</span><b>${escapeHtml(String(loan.term || '—'))} month${Number(loan.term) === 1 ? '' : 's'}</b></div>
                <div><span>No. of Payments</span><b>${paymentCount} payment${paymentCount === 1 ? '' : 's'}</b></div>
                <div><span>Maturity Date</span><b>${formatDate(maturity)}</b></div>
                <div><span>Total Interest</span><b>${peso(calc.totalInterest || 0)}</b></div>
              </div>
            </section>
          </div>
        </div>
        <div class="loan-schedule-panel" id="loanSchedulePanel" hidden>
          <div class="loan-schedule-meta"><span>${loanPayments.length} recorded payment${loanPayments.length === 1 ? '' : 's'}</span>${latestPayment ? `<span>Latest: ${formatDate(latestPayment.date)} · ${peso(latestPayment.amount)}</span>` : '<span>No payments recorded yet.</span>'}</div>
          <div class="loan-schedule-scroll">
            <table><thead><tr><th>#</th><th>DATE</th><th>RECEIPT</th><th>AMOUNT</th><th>BALANCE AFTER</th></tr></thead><tbody>
              ${loanPayments.map((p,i)=>`<tr><td>${i+1}</td><td>${formatDate(p.date)}</td><td>${escapeHtml(p.receiptNo || p.refId || '—')}</td><td>${peso(p.amount || 0)}</td><td>${peso(p.balanceAfterPayment != null ? p.balanceAfterPayment : p.remainingOutstandingBalance || 0)}</td></tr>`).join('') || `<tr><td colspan="5"><div class="empty-state">No payment records for this loan yet.</div></td></tr>`}
            </tbody></table>
          </div>
        </div>
      </div>
    </div>`;

  root.querySelectorAll('[data-loan-detail-tab]').forEach(tab => tab.addEventListener('click', () => {
    root.querySelectorAll('[data-loan-detail-tab]').forEach(x => x.classList.remove('active'));
    tab.classList.add('active');
    const schedule = tab.dataset.loanDetailTab === 'schedule';
    root.querySelector('#loanOverviewPanel').hidden = schedule;
    root.querySelector('#loanSchedulePanel').hidden = !schedule;
  }));
}

function viewLoanDetails(encodedId) {
  const id = decodeURIComponent(encodedId || '');
  const loan = DATA.loans.find(l => String(l.id) === String(id));
  if (!loan) { alert('Loan record could not be found.'); return; }
  ACTIVE_LOAN_DETAIL_ID = id;
  showView('loanDetail');
}

function collectLoan(encodedId) {
  const id = decodeURIComponent(encodedId || '');
  const loan = DATA.loans.find(l => String(l.id) === String(id));
  if (!loan) { alert('Loan record could not be found.'); return; }
  if (loanCalc(loan).outstanding <= 0.009) { alert('This loan is already fully paid.'); return; }

  showView('collections');
  renderCollections();
  const sel = document.getElementById('paySelectLoan');
  if (!sel) return;
  if ([...sel.options].some(option => String(option.value) === String(id))) sel.value = id;
  renderCollections();
  const amount = document.getElementById('payAmount');
  if (amount) { amount.focus(); amount.select?.(); }
}

document.getElementById('btnCreateLoan').addEventListener('click', openLoanModal);

function loanModalType(type) {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('business')) return 'Business Loan';
  if (normalized.includes('group')) return 'Group Loan';
  return 'Salary Loan';
}

function loanModalRule(type) {
  const rule = loanRuleFor(type);
  const defaults = {
    'Salary Loan': { rate: 7, min: 1, max: 12 },
    'Business Loan': { rate: 3.5, min: 2, max: 4 },
    'Group Loan': { rate: 5, min: 1, max: 6 }
  };
  const d = defaults[type] || defaults['Salary Loan'];
  return {
    rate: Number.isFinite(rule.interestRate) && rule.interestRate > 0 ? rule.interestRate : d.rate,
    min: Math.max(1, Number(rule.minTerm || d.min)),
    max: Math.max(Number(rule.minTerm || d.min), Number(rule.maxTerm || d.max))
  };
}

function openLoanModal(initialType = 'Salary Loan') {
  if (DATA.clients.length === 0) {
    alert('Please add a client first.');
    showView('clients');
    return;
  }

  const clientOptions = DATA.clients
    .filter(c => !isArchivedClient(c))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => `<option value="${escapeHtml(c.name)}" data-client-id="${escapeHtml(c.id)}">${escapeHtml(c.name)}${c.contact ? ` · ${escapeHtml(c.contact)}` : ''}</option>`)
    .join('');

  const types = ['Salary Loan', 'Business Loan', 'Group Loan'];
  const selectedType = loanModalType(initialType);

  openModal(`
    <div class="loan-record-modal" data-loan-type="${escapeHtml(selectedType)}">
      <div class="loan-record-header">
        <div class="loan-record-title"><span class="loan-record-title-icon">▣</span><h2>Loan Payment Record</h2></div>
        <button class="loan-record-close" type="button" onclick="closeModal()" aria-label="Close">×</button>
      </div>

      <div class="loan-record-tabs" role="tablist" aria-label="Loan type">
        ${types.map(type => `<button type="button" class="loan-record-tab ${type === selectedType ? 'active' : ''}" data-loan-type-tab="${escapeHtml(type)}" onclick="switchLoanRecordType('${escapeJs(type)}')"><span>${type === 'Salary Loan' ? '▣' : type === 'Business Loan' ? '▤' : '♧'}</span>${escapeHtml(type.toUpperCase())}</button>`).join('')}
      </div>

      <div class="loan-record-layout">
        <div class="loan-record-main">
          <section class="loan-record-section">
            <div class="loan-record-section-title">BORROWER &amp; LOAN DETAILS</div>
            <div class="loan-record-section-body">
              <label class="loan-record-label">CLIENT'S NAME *</label>
              <input id="mlClientSearch" class="loan-record-input full" list="mlClientList" placeholder="Search by name, ID, or contact..." autocomplete="off">
              <datalist id="mlClientList">${clientOptions}</datalist>
              <input id="mlClient" type="hidden">

              <div class="loan-record-grid-2">
                <div>
                  <label class="loan-record-label">PRINCIPAL AMOUNT *</label>
                  <div class="loan-money-input"><span>₱</span><input id="mlPrincipal" type="number" min="0" step="0.01" value="" placeholder="0"></div>
                </div>
                <div>
                  <label class="loan-record-label">DATE GRANTED *</label>
                  <div class="loan-date-input"><input id="mlStart" type="date" value="${todayISO()}"><span>▣</span></div>
                </div>
              </div>

              <div class="loan-record-grid-2 loan-record-grid-bottom">
                <div>
                  <label class="loan-record-label">PAYMENT MODE</label>
                  <select id="mlPaymentMode"></select>
                </div>
                <div>
                  <label class="loan-record-label" id="mlTermLabel">NO. OF MONTHS</label>
                  <select id="mlTerm"></select>
                </div>
              </div>
            </div>
          </section>

          <section class="loan-record-section">
            <div class="loan-record-section-title">INTEREST RATE &amp; CHARGES</div>
            <div class="loan-record-section-body" id="loanChargesBody"></div>
          </section>
          <div id="mlError" class="loan-record-error"></div>
        </div>

        <aside class="loan-record-summary" id="loanRecordSummary"></aside>
      </div>

      <div class="loan-record-footer">
        <div id="mlFooterError" class="loan-record-footer-error">Complete all required fields</div>
        <button class="loan-record-cancel" type="button" onclick="closeModal()">CANCEL</button>
        <button class="loan-record-save" type="button" id="mlSaveBtn" onclick="saveLoan()"><span>✓</span> SAVE LOAN RECORD</button>
      </div>
    </div>
  `, 'loan-record-form-modal');

  document.getElementById('mlClientSearch')?.addEventListener('input', syncLoanClientSelection);
  document.getElementById('mlPrincipal')?.addEventListener('input', renderLoanRecordSummary);
  document.getElementById('mlStart')?.addEventListener('change', renderLoanRecordSummary);
  document.getElementById('mlTerm')?.addEventListener('change', renderLoanRecordSummary);
  document.getElementById('mlPaymentMode')?.addEventListener('change', renderLoanRecordSummary);
  document.getElementById('loanChargesBody')?.addEventListener('input', renderLoanRecordSummary);
  renderLoanRecordType(selectedType);
}

function syncLoanClientSelection() {
  const input = document.getElementById('mlClientSearch');
  const hidden = document.getElementById('mlClient');
  if (!input || !hidden) return;
  const value = input.value.trim().toLowerCase();
  const client = DATA.clients.find(c => String(c.name || '').trim().toLowerCase() === value || String(c.id || '').toLowerCase() === value || String(c.contact || '').toLowerCase() === value);
  hidden.value = client?.id || '';
  renderLoanRecordSummary();
}

function switchLoanRecordType(type) {
  const modal = document.querySelector('.loan-record-modal');
  if (!modal) return;
  modal.dataset.loanType = loanModalType(type);
  modal.querySelectorAll('[data-loan-type-tab]').forEach(tab => tab.classList.toggle('active', tab.dataset.loanTypeTab === modal.dataset.loanType));
  renderLoanRecordType(modal.dataset.loanType);
}

function renderLoanRecordType(type) {
  const modal = document.querySelector('.loan-record-modal');
  if (!modal) return;
  const selected = loanModalType(type);
  modal.dataset.loanType = selected;
  modal.querySelectorAll('[data-loan-type-tab]').forEach(tab => tab.classList.toggle('active', tab.dataset.loanTypeTab === selected));

  const rule = loanModalRule(selected);
  const mode = document.getElementById('mlPaymentMode');
  const term = document.getElementById('mlTerm');
  const termLabel = document.getElementById('mlTermLabel');
  if (!mode || !term) return;

  const isSalary = selected === 'Salary Loan';
  const isBusiness = selected === 'Business Loan';
  const isGroup = selected === 'Group Loan';
  mode.innerHTML = isSalary
    ? '<option value="Semi-Monthly">Semi-Monthly</option>'
    : '<option value="Weekly">Weekly</option>';
  mode.disabled = isSalary || isGroup;

  if (isGroup) {
    termLabel.textContent = 'LOAN TERM';
    term.innerHTML = [13,17,21,25,29,33].map(w => `<option value="${Math.max(1, Math.ceil(w / 4))}" data-weeks="${w}" ${w === 25 ? 'selected' : ''}>${w} weeks</option>`).join('');
  } else {
    termLabel.textContent = 'NO. OF MONTHS';
    const values = [];
    for (let i = rule.min; i <= rule.max; i++) values.push(i);
    const fallback = isBusiness ? 4 : 6;
    term.innerHTML = values.map(v => `<option value="${v}" ${v === fallback ? 'selected' : ''}>${v} month${v === 1 ? '' : 's'}</option>`).join('');
  }

  const penalty = Number(DATA.settings.penaltyRate || 3) || 3;
  const grace = Number(DATA.settings.gracePeriod || 7) || 7;
  const defaultRate = isSalary ? 7 : isBusiness ? 3.5 : 5;
  const rates = isBusiness ? [3.5,4,4.5,5] : [defaultRate];
  const currentRate = Number(document.getElementById('mlRate')?.value || defaultRate);
  const rate = isBusiness && rates.includes(currentRate) ? currentRate : defaultRate;

  const rateSelector = isBusiness ? `
    <label class="loan-record-label">INTEREST RATE</label>
    <div class="loan-rate-selector">${rates.map(r => `<button type="button" class="loan-rate-option ${r === rate ? 'active' : ''}" data-rate="${r}" onclick="setLoanRecordRate(${r})">${r.toFixed(1)}%</button>`).join('')}</div>` : '';
  const cards = `<div class="loan-charge-cards">
      <div class="loan-charge-card primary"><span>INTEREST RATE</span><strong id="mlRateDisplay">${rate}%</strong><small>/ month</small></div>
      <div class="loan-charge-card"><span>PENALTY RATE</span><strong>${penalty}%</strong><small>/ period overdue</small></div>
      <div class="loan-charge-card"><span>GRACE PERIOD</span><strong>${grace}</strong><small>days</small></div>
    </div>`;
  const extras = isSalary ? '' : `<div class="loan-extra-grid">
      <div><label class="loan-record-label">SAVINGS / CBU (PER PERIOD)</label><div class="loan-money-input"><span>₱</span><input id="mlCbu" type="number" min="0" step="0.01" value="100" placeholder="0"></div></div>
      <div><label class="loan-record-label">${isGroup ? 'ADDITIONAL FEE' : 'SAVINGS / CBU (PER PERIOD)'}</label><div class="loan-money-input muted"><span>₱</span><input id="mlGroupFee" type="number" min="0" step="0.01" value="0" placeholder="0"></div></div>
    </div>`;
  document.getElementById('loanChargesBody').innerHTML = `${rateSelector}${cards}${extras}<input id="mlRate" type="hidden" value="${rate}">`;
  renderLoanRecordSummary();
}

function setLoanRecordRate(rate) {
  const input = document.getElementById('mlRate');
  if (input) input.value = rate;
  document.querySelectorAll('.loan-rate-option').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.rate) === Number(rate)));
  const display = document.getElementById('mlRateDisplay');
  if (display) display.textContent = `${Number(rate).toFixed(1)}%`;
  renderLoanRecordSummary();
}

function loanRecordValues() {
  const modal = document.querySelector('.loan-record-modal');
  const type = modal?.dataset.loanType || 'Salary Loan';
  const termEl = document.getElementById('mlTerm');
  const weeks = Number(termEl?.selectedOptions?.[0]?.dataset?.weeks || 0);
  const termMonths = Number(termEl?.value || 0);
  const principal = Number(document.getElementById('mlPrincipal')?.value || 0);
  const rate = Number(document.getElementById('mlRate')?.value || 0);
  const cbu = Number(document.getElementById('mlCbu')?.value || 0);
  const fee = Number(document.getElementById('mlGroupFee')?.value || 0);
  const interest = principal * (rate / 100) * termMonths;
  const total = principal + interest;
  const payments = type === 'Salary Loan' ? termMonths * 2 : type === 'Group Loan' ? (weeks || termMonths * 4) : termMonths * 4;
  const amortization = payments ? total / payments : 0;
  return { type, termMonths, weeks, principal, rate, cbu, fee, interest, total, payments, amortization, startDate: document.getElementById('mlStart')?.value || '' };
}

function renderLoanRecordSummary() {
  const root = document.getElementById('loanRecordSummary');
  if (!root) return;
  const v = loanRecordValues();
  const client = DATA.clients.find(c => String(c.id) === String(document.getElementById('mlClient')?.value));
  const paymentMode = document.getElementById('mlPaymentMode')?.value || (v.type === 'Salary Loan' ? 'Semi-Monthly' : 'Weekly');
  const maturity = v.startDate && v.termMonths ? addMonthsISO(v.startDate, v.termMonths) : '';
  const termText = v.type === 'Group Loan' ? `${v.weeks || v.termMonths * 4} weeks` : `${v.termMonths || '—'} month${v.termMonths === 1 ? '' : 's'}`;
  const color = v.type === 'Salary Loan' ? '#087db7' : v.type === 'Business Loan' ? '#d65d0b' : '#7617ed';
  root.style.setProperty('--loan-accent', color);
  root.innerHTML = `<div class="loan-summary-label">LOAN SUMMARY <span class="loan-type-pill">${escapeHtml(v.type)}</span></div>
    <div class="loan-summary-block"><span>BORROWER</span><strong class="summary-client">${escapeHtml(client?.name || 'No client selected')}</strong></div>
    <div class="loan-summary-block large"><span>TOTAL AMOUNT PAYABLE</span><strong>${peso(v.total || 0)}</strong></div>
    <div class="loan-summary-block large"><span>AMORTIZATION</span><strong>${peso(v.amortization || 0)}</strong><small>per ${paymentMode.toLowerCase()} · ${v.payments || '—'} payments</small></div>
    <div class="loan-summary-section"><h4>▣ &nbsp;SCHEDULE</h4>
      <div><span>Date Granted</span><b>${v.startDate ? formatDate(v.startDate) : '—'}</b></div>
      <div><span>Maturity Date</span><b>${maturity ? formatDate(maturity) : '—'}</b></div>
      <div><span>Loan Term</span><b>${termText}</b></div>
      <div><span>No. of Payments</span><b>${v.payments || '—'} payments</b></div>
      <div><span>Payment Mode</span><b>${paymentMode}</b></div>
    </div>
    <div class="loan-summary-section"><h4>▣ &nbsp;CHARGES</h4>
      <div><span>Interest Rate</span><b>${v.rate}% / month</b></div>
      <div><span>Interest Amount</span><b>${peso(v.interest || 0)}</b></div>
      <div><span>Penalty Rate</span><b>${Number(DATA.settings.penaltyRate || 3)}% / period</b></div>
      <div><span>Grace Period</span><b>${Number(DATA.settings.gracePeriod || 7)} days</b></div>
      ${v.cbu ? `<div><span>Savings / CBU</span><b>${peso(v.cbu)} / period</b></div>` : ''}
      ${v.fee ? `<div><span>Additional Fee</span><b>${peso(v.fee)}</b></div>` : ''}
    </div>`;
}

async function saveLoan() {
  syncLoanClientSelection();
  const clientId = document.getElementById('mlClient')?.value || '';
  const v = loanRecordValues();
  const error = document.getElementById('mlError');
  const footerError = document.getElementById('mlFooterError');
  const btn = document.getElementById('mlSaveBtn');

  if (!clientId || v.principal <= 0 || v.termMonths <= 0 || v.rate < 0 || !v.startDate) {
    if (error) { error.textContent = 'Please complete all required fields and enter a valid principal amount.'; error.classList.add('show'); }
    if (footerError) footerError.textContent = 'Complete all required fields';
    return;
  }

  const clientName = DATA.clients.find(c => String(c.id) === String(clientId))?.name || 'the selected client';
  const termText = v.type === 'Group Loan' ? `${v.weeks} weeks` : `${v.termMonths} months`;
  const confirmed = window.confirm(`Confirm new loan record\n\nClient: ${clientName}\nLoan Type: ${v.type}\nPrincipal: ${peso(v.principal)}\nTerm: ${termText}\nInterest Rate: ${v.rate}%\nDate Granted: ${v.startDate}\n\nDo you want to save this loan record?`);
  if (!confirmed) return;

  btn.disabled = true;
  btn.innerHTML = '<span>…</span> SAVING LOAN RECORD';
  if (error) error.classList.remove('show');
  if (footerError) footerError.textContent = '';

  const payload = {
    clientId,
    type: v.type,
    principal: v.principal,
    termMonths: v.termMonths,
    interestRatePercent: v.rate,
    startDate: v.startDate,
    cbu: v.cbu,
    groupAvailmentFee: v.fee
  };

  try {
    const created = await api.post('/loans', payload);
    if (isAdmin() && created?.id) await api.post(`/loans/${created.id}/approve`);
    closeModal();
    await loadAllFromApi();
    renderAll();
    showView('loandesk');
    alert(isAdmin() ? 'Loan created and released successfully.' : 'Loan created successfully.');
  } catch (err) {
    if (error) { error.textContent = err.message || 'Could not create the loan.'; error.classList.add('show'); }
    if (footerError) footerError.textContent = err.message || 'Could not create the loan.';
    btn.disabled = false;
    btn.innerHTML = '<span>✓</span> SAVE LOAN RECORD';
  }
}
let LAST_RECEIPT = null;

/* ====================== COLLECTIONS ====================== */
function renderCollections() {
  const payableLoans = DATA.loans.filter(l => !['rejected', 'fully_paid'].includes(l.status));
  const sel = document.getElementById('paySelectLoan');
  const previous = sel.value;
  sel.innerHTML = payableLoans.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.clientName)} · ${escapeHtml(l.refId || '')}</option>`).join('') || '<option value="">No active borrowers</option>';
  if (payableLoans.some(l => l.id === previous)) sel.value = previous;
  const selected = DATA.loans.find(l => l.id === sel.value);
  const collectorName = CURRENT_USER?.fullName || CURRENT_USER?.email || 'Current Collector';
  document.getElementById('collectorSelect').innerHTML = `<option>${escapeHtml(collectorName)} · Field Collector</option>`;
  const summary = document.getElementById('selectedLoanSummary');
  if (summary) summary.innerHTML = selected ? `
    <div><span>UPDATED BALANCE</span><b>${peso(loanCalc(selected).outstanding)}</b></div>
    <strong>${escapeHtml(selected.clientName)} · ${escapeHtml(selected.refId || '')}</strong>` : '<span>No active loan selected.</span>';
  renderReceiptHistory();
  renderLatestReceipt();
}

function clearPaymentEntry() {
  const amount = document.getElementById('payAmount');
  if (amount) amount.value = '';
  const sel = document.getElementById('paySelectLoan');
  if (sel) { sel.selectedIndex = 0; renderCollections(); }
}

function renderReceiptHistory() {
  const dateFilter = document.getElementById('receiptDateFilter')?.value || '';
  const nameFilter = (document.getElementById('receiptNameSearch')?.value || '').trim().toLowerCase();
  let payments = activePayments().sort((a,b) => {
    const dateCompare = String(b.date || '').localeCompare(String(a.date || ''));
    if (dateCompare !== 0) return dateCompare;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
  if (dateFilter) payments = payments.filter(p => String(p.date || '') === dateFilter);
  if (nameFilter) payments = payments.filter(p => String(p.clientName || '').toLowerCase().includes(nameFilter));

  const count = document.getElementById('receiptHistoryCount');
  if (count) count.textContent = `${payments.length} receipt${payments.length === 1 ? '' : 's'}`;
  const body = document.getElementById('receiptHistoryBody');
  if (!body) return;
  body.innerHTML = payments.map(p => `
    <tr>
      <td><b>${escapeHtml(p.id || '—')}</b></td>
      <td>${formatDate(p.date)}</td>
      <td><b>${escapeHtml(p.clientName || '—')}</b></td>
      <td>${escapeHtml((DATA.loans.find(l => l.id === p.loanId)?.refId) || p.loanId || '—')}</td>
      <td class="money">${peso(p.amount)}</td>
      <td><span class="payment-method-pill">${escapeHtml(p.method || '—')}</span></td>
      <td><button class="table-action light" onclick="viewPaymentReceipt('${escapeJs(p.id)}')">◉ View</button></td>
    </tr>`).join('') || `<tr><td colspan="7"><div class="empty-state">${dateFilter && nameFilter ? 'No receipts match the selected date and borrower name.' : dateFilter ? 'No receipts were recorded on the selected date.' : nameFilter ? 'No receipts match that borrower name.' : 'No receipts have been recorded.'}</div></td></tr>`;
}



function renderLatestReceipt() {
  const content = document.getElementById('receiptStatusContent');
  if (!content) return;
  const latest = [...activePayments()].sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
  if (!latest) {
    content.innerHTML = '<div class="receipt-status-empty">No payment recorded yet.</div>';
    document.getElementById('receiptPrintArea').innerHTML = '';
    return;
  }
  const loan = DATA.loans.find(l => l.id === latest.loanId);
  content.innerHTML = `
    <div class="latest-payment-amount">${peso(latest.amount)}</div>
    <div class="latest-payment-borrower">${escapeHtml(latest.clientName)} · ${escapeHtml(loan?.refId || latest.loanId || '')}</div>
    <div class="receipt-status-details">
      <div><span>Receipt Number</span><b>${escapeHtml(latest.id || '—')}</b></div>
      <div><span>Collector</span><b>${escapeHtml(latest.recordedByName || CURRENT_USER?.fullName || 'Field Collector')}</b></div>
      <div><span>Date</span><b>${formatDate(latest.date)}</b></div>
    </div>`;
  document.getElementById('receiptPrintArea').innerHTML = `<div class="receipt-print-actions"><button class="btn btn-outline btn-block" onclick="viewPaymentReceipt('${escapeJs(latest.id)}')">▣ Print Receipt</button></div>`;
}

function renderCollectionQueue() { /* queue is represented by Receipt History in the new Collection layout */ }
function selectCollectionLoan(id) {
  const sel = document.getElementById('paySelectLoan');
  if (sel) { sel.value = id; renderCollections(); document.getElementById('payAmount').focus(); }
}

let currentCollectionTab = 'due_today';

const paySelectLoanEl = document.getElementById('paySelectLoan');
paySelectLoanEl.addEventListener('change', renderCollections);
document.getElementById('receiptDateFilter')?.addEventListener('change', renderReceiptHistory);
document.getElementById('receiptNameSearch')?.addEventListener('input', renderReceiptHistory);

document.getElementById('btnAuthorizeEntry').addEventListener('click', async () => {
  const loanId = document.getElementById('paySelectLoan').value;
  const amount = Number(document.getElementById('payAmount').value);
  const methodText = document.getElementById('payMethod').value;
  if (!loanId) { alert('Select a borrower.'); return; }
  if (!amount || amount <= 0) { alert('Enter a valid amount.'); return; }

  const selectedLoanBefore = DATA.loans.find(l => l.id === loanId);
  const balanceBefore = selectedLoanBefore ? loanCalc(selectedLoanBefore).outstanding : 0;
  const confirmed = window.confirm(`Confirm payment\\n\\nBorrower: ${selectedLoanBefore?.clientName || '—'}\\nLoan: ${selectedLoanBefore?.refId || loanId}\\nAmount: ${peso(amount)}\\nMethod: ${methodText}\\nOutstanding before payment: ${peso(balanceBefore)}\\n\\nRecord this payment?`);
  if (!confirmed) return;

  const btn = document.getElementById('btnAuthorizeEntry');
  btn.disabled = true; btn.textContent = 'Processing...';
  try {
    const result = await api.post('/payments', { loanId, amount, method: PAYMENT_METHOD_TO_ENUM[methodText] || 'CASH', date: todayISO() });
    const collectorName = (CURRENT_USER && (CURRENT_USER.fullName || CURRENT_USER.email)) || 'System';
    LAST_RECEIPT = {
      id: result.id || '', loanId, refId: selectedLoanBefore?.refId || '', clientId: result.clientId || selectedLoanBefore?.clientId,
      clientName: result.clientName || selectedLoanBefore?.clientName || '', date: result.date || todayISO(),
      method: PAYMENT_METHOD_LABEL[result.method] || result.method || methodText, collector: collectorName,
      paymentAmount: Number(result.amount != null ? result.amount : amount), principalApplied: Number(result.principalApplied || 0),
      interestApplied: Number(result.interestApplied || 0), excess: Number(result.excess || 0),
      balanceBefore: Number(result.balanceBeforePayment ?? balanceBefore), balanceAfter: Number(result.balanceAfterPayment ?? result.remainingOutstandingBalance ?? 0), voided: false
    };
    await loadAllFromApi();
    document.getElementById('payAmount').value = '';
    renderCollections(); renderLoanDesk(); renderClients(); renderArchive(); renderFinancials(); await renderDashboard(); renderReceiptSuccess();
    if (Number(result.excess || 0) > 0.01) alert(`Payment recorded. ${peso(Number(result.excess))} excess was logged as advance payment.`);
  } catch (err) { alert(err.message); }
  finally { btn.disabled = false; btn.textContent = 'Record Payment'; }
});

async function voidPayment(paymentId) {
  const payment = DATA.payments.find(p => p.id === paymentId);
  if (!payment || payment.voided) return;
  const confirmed = window.confirm(`Void receipt ${payment.id}?\\n\\nBorrower: ${payment.clientName}\\nAmount: ${peso(payment.amount)}\\nDate: ${formatDate(payment.date)}\\n\\nThe receipt will remain in history marked as VOIDED, but its payment amount will no longer count toward the loan balance.\\n\\nContinue?`);
  if (!confirmed) return;
  try {
    await api.post(`/payments/${encodeURIComponent(paymentId)}/void`, {});
    await loadAllFromApi();
    if (LAST_RECEIPT?.id === paymentId) LAST_RECEIPT = null;
    renderCollections(); renderLoanDesk(); renderClients(); renderArchive(); renderFinancials(); await renderDashboard();
    alert(`Receipt ${paymentId} was voided. The record remains in Receipt History.`);
  } catch (err) { alert(err.message); }
}

function viewPaymentReceipt(paymentId) {
  const p = DATA.payments.find(x => x.id === paymentId);
  if (!p) { alert('Receipt record not found.'); return; }
  const loan = DATA.loans.find(l => l.id === p.loanId);
  const currentBalance = loan ? loanCalc(loan).outstanding : 0;
  const before = p.balanceBeforePayment > 0 ? p.balanceBeforePayment : currentBalance + (p.voided ? 0 : p.principalApplied + p.interestApplied);
  const after = p.balanceAfterPayment > 0 || before === p.principalApplied + p.interestApplied ? p.balanceAfterPayment : Math.max(0, before - p.principalApplied - p.interestApplied);
  LAST_RECEIPT = {
    id: p.id, loanId: p.loanId, refId: loan?.refId || p.loanId, clientId: p.clientId, clientName: p.clientName,
    date: p.date, method: p.method, collector: p.recordedByName || CURRENT_USER?.fullName || 'Field Collector', paymentAmount: p.amount,
    principalApplied: p.principalApplied, interestApplied: p.interestApplied, excess: p.excess,
    balanceBefore: before, balanceAfter: after, voided: !!p.voided
  };
  previewLastReceipt();
}

function renderReceiptSuccess() {
  // Keep the reference-style Receipt Status card in sync after a successful entry.
  renderLatestReceipt();
}

function buildPrintableReceipt() {
  if (!LAST_RECEIPT) return '';

  const r = LAST_RECEIPT;
  const company = 'La Familia David Lending Corporation';

  return `
    <div id="printReceipt">
      <div class="print-receipt-sheet">
        <div class="print-receipt-title">
          <h1>${escapeHtml(company)}</h1>
          <p>OFFICIAL PAYMENT RECEIPT</p>
        </div>

        <div class="print-meta-grid">
          <div class="print-meta-field"><span>Receipt No.</span><b>${escapeHtml(r.id || '—')}</b></div>
          <div class="print-meta-field"><span>Date</span><b>${escapeHtml(formatDate(r.date))}</b></div>
          <div class="print-meta-field"><span>Borrower</span><b>${escapeHtml(r.clientName || '—')}</b></div>
          <div class="print-meta-field"><span>Loan Ref.</span><b>${escapeHtml(r.refId || '—')}</b></div>
          <div class="print-meta-field"><span>Collector</span><b>${escapeHtml(r.collector || '—')}</b></div>
          <div class="print-meta-field"><span>Method</span><b>${escapeHtml(r.method || '—')}</b></div>
        </div>

        <div class="print-balance-grid">
          <div><span>OUTSTANDING BEFORE PAYMENT</span><b>${peso(r.balanceBefore)}</b></div>
          <div><span>PAYMENT RECEIVED TODAY</span><b>${peso(r.paymentAmount)}</b></div>
          <div><span>OUTSTANDING AFTER PAYMENT</span><b>${peso(r.balanceAfter)}</b></div>
        </div>

        <table class="print-summary">
          <tr><td>Principal Applied</td><td>${peso(r.principalApplied)}</td></tr>
          <tr><td>Interest Applied</td><td>${peso(r.interestApplied)}</td></tr>
          <tr><td>Total Payment</td><td>${peso(r.paymentAmount)}</td></tr>
          <tr><td>Balance Deducted</td><td>${peso(Math.max(0, r.balanceBefore - r.balanceAfter))}</td></tr>
          <tr><td>Remaining Outstanding Balance</td><td>${peso(r.balanceAfter)}</td></tr>
        </table>

        <div class="print-footer">
          <div class="print-sign">Borrower Signature</div>
          <div class="print-sign">Collector Signature</div>
        </div>

        <p class="print-note">Please keep this receipt for your records. The remaining balance shown above is the balance after today's recorded payment.</p>
        ${r.voided ? '<p class="print-voided">VOIDED RECEIPT</p>' : ''}
      </div>
    </div>
  `;
}

function printLastReceipt() {
  if (!LAST_RECEIPT) {
    alert('Record a payment first before printing a receipt.');
    return;
  }

  const printWindow = window.open('', '_blank', 'width=900,height=760');
  if (!printWindow) {
    alert('Please allow pop-ups in your browser so the receipt can be printed.');
    return;
  }

  const receiptHtml = buildPrintableReceipt();

  printWindow.document.open();
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Payment Receipt - ${escapeHtml(LAST_RECEIPT.clientName)}</title>
        <meta charset="utf-8">
        <style>
          *{box-sizing:border-box}
          html,body{margin:0;padding:0;background:#fff;color:#0d1830;font-family:Arial,Helvetica,sans-serif}
          body{padding:7px}
          .print-receipt-sheet{width:568px;min-height:430px;margin:0 auto;border:1px solid #18213a;padding:22px 20px 18px;background:#fff}
          .print-receipt-title{text-align:center;margin:0 0 10px;padding-bottom:9px;border-bottom:1px solid #18213a}
          .print-receipt-title h1{font-size:15px;line-height:1.2;margin:0 0 3px;font-weight:700}
          .print-receipt-title p{font-size:8px;letter-spacing:.55px;margin:0;color:#8793a8}
          .print-meta-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:22px;row-gap:0;margin:0 0 9px}
          .print-meta-field{display:flex;justify-content:space-between;align-items:center;gap:10px;min-height:17px;font-size:8px}
          .print-meta-field span{color:#75839a;white-space:nowrap}
          .print-meta-field b{font-size:8px;font-weight:500;color:#172038;text-align:right}
          .print-balance-grid{display:grid;grid-template-columns:1fr 1fr 1fr;border:1px solid #18213a;margin:0 0 10px}
          .print-balance-grid>div{min-height:47px;padding:7px 5px 5px;text-align:center;border-right:1px solid #c6ceda;display:flex;flex-direction:column;justify-content:center}
          .print-balance-grid>div:last-child{border-right:0}
          .print-balance-grid span{font-size:6.5px;color:#7d8ba0;line-height:1.15;margin-bottom:5px}
          .print-balance-grid b{font-size:10px;font-weight:700;color:#172038}
          .print-summary{width:100%;border-collapse:collapse;margin:0}
          .print-summary td{border:1px solid #18213a;padding:5px 7px;font-size:8px;height:23px}
          .print-summary td:last-child{text-align:right;font-weight:700}
          .print-footer{display:grid;grid-template-columns:1fr 1fr;gap:64px;margin-top:31px}
          .print-sign{border-top:1px solid #18213a;text-align:center;padding-top:5px;font-size:7px;color:#344056}
          .print-note{text-align:center;color:#9aa5b5;font-size:6.5px;line-height:1.4;margin:17px 10px 0}
          .print-voided{text-align:center;color:#d92f50;font-size:8px;font-weight:700;margin:5px 0 0}
          @page{size:auto;margin:0}
          @media print{body{padding:0}.print-receipt-sheet{margin:0 auto}}
        </style>
      </head>
      <body>${receiptHtml.replace('<div id="printReceipt">','').replace('</div>\n    </div>','')}</body>
    </html>
  `);
  printWindow.document.close();

  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 250);
}

function previewLastReceipt() {
  if (!LAST_RECEIPT) {
    alert('Record a payment first before previewing a receipt.');
    return;
  }
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-overlay" id="receiptPreviewOverlay">
      <div class="modal-box" style="width:min(760px,94vw);max-height:90vh;overflow:auto">
        <div class="modal-head">
          <h3>Receipt Preview</h3>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        ${buildPrintableReceipt()}
        <div style="display:flex;justify-content:flex-end;gap:7px;margin-top:12px">
          <button class="btn btn-outline" onclick="closeModal()">Close</button>
          <button class="btn btn-primary" onclick="printLastReceipt()">Print Receipt</button>
        </div>
      </div>
    </div>
  `;
}

document.getElementById('btnPaymentTop').addEventListener('click', () => showView('collections'));

function escapeAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str == null ? '' : str);
  return div.innerHTML;
}

/* ====================== FINANCIALS ====================== */
let currentFinTab = 'overview';
document.querySelectorAll('#finTabs .tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('#finTabs .tab').forEach(x=>x.classList.remove('active'));
  t.classList.add('active'); currentFinTab=t.dataset.fin; renderFinancials();
}));

function escapeJs(value) {
  return encodeURIComponent(String(value ?? ''));
}

const ANALYTICS_COLORS = {
  teal: '#0b7f96',
  green: '#21876d',
  blue: '#1489b8',
  lightBlue: '#dff4ff',
  amber: '#f59a1b',
  red: '#ef3159',
  cyan: '#18a9df'
};

let analyticsRange = 'year';

function analyticsDate(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  const d = new Date(`${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function monthLabel(d) {
  return d.toLocaleDateString('en-PH', { month: 'short' });
}

function addMonthsDate(d, count) {
  return new Date(d.getFullYear(), d.getMonth() + count, 1);
}

function analyticsPeriods(range) {
  const now = analyticsDate(todayISO()) || new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  let count = 12;
  let start;
  if (range === 'month') {
    start = currentMonth;
    count = 1;
  } else if (range === 'six_months') {
    count = 6;
    start = addMonthsDate(currentMonth, -(count - 1));
  } else if (range === 'year') {
    start = new Date(now.getFullYear(), 0, 1);
    count = now.getMonth() + 1;
  } else {
    count = 12;
    start = addMonthsDate(currentMonth, -(count - 1));
  }
  return Array.from({length: count}, (_, i) => addMonthsDate(start, i));
}

function analyticsRangeLabel(range) {
  return {
    month: 'This month',
    six_months: 'Last 6 months',
    year: 'This year',
    twelve_months: 'Last 12 months'
  }[range] || 'This year';
}

function renderDataAnalytics(host) {
  if (!host) return;
  const periods = analyticsPeriods(analyticsRange);
  const firstPeriod = periods[0];
  const lastPeriod = periods[periods.length - 1];
  const inRange = d => {
    if (!d) return false;
    const key = monthKey(d);
    return key >= monthKey(firstPeriod) && key <= monthKey(lastPeriod);
  };

  const portfolio = DATA.loans.filter(l => l.status !== 'rejected');
  const validPayments = DATA.payments.filter(p => !p.voided);

  const collectionsByMonth = periods.map(period => {
    const key = monthKey(period);
    return validPayments.filter(p => {
      const d = analyticsDate(p.date);
      return d && monthKey(d) === key;
    }).reduce((sum,p) => sum + Number(p.amount || 0), 0);
  });

  const releasesByMonth = periods.map(period => {
    const key = monthKey(period);
    return portfolio.filter(l => {
      const d = analyticsDate(l.startDate);
      return d && monthKey(d) === key;
    }).reduce((sum,l) => sum + Number(l.principal || 0), 0);
  });

  const categories = (DATA.settings.loanTypes || ['Individual Loan','Group Loan','Business Loan']).map(type => {
    const loans = portfolio.filter(l => l.type === type && analyticsDate(l.startDate) && inRange(analyticsDate(l.startDate)));
    return {
      type,
      label: String(type).replace(/\s+loan$/i,''),
      amount: loans.reduce((sum,l) => sum + loanCalc(l).outstanding, 0),
      accounts: new Set(loans.map(l => l.clientId)).size
    };
  });

  const statuses = [
    { key: 'current', label: 'CURRENT', color: ANALYTICS_COLORS.green },
    { key: 'due_today', label: 'DUE TODAY', color: ANALYTICS_COLORS.amber },
    { key: 'past_due', label: 'PAST DUE', color: ANALYTICS_COLORS.red },
    { key: 'partial_payment', label: 'PARTIAL', color: ANALYTICS_COLORS.cyan }
  ].map(item => ({...item, count: portfolio.filter(l => {
    if (l.status === 'fully_paid' || l.status === 'rejected') return false;
    const status = l.status;
    if (item.key === 'current') return status === 'current';
    if (item.key === 'partial_payment') return status === 'partial_payment';
    return scheduleBucket(l) === item.key;
  }).length}));

  host.innerHTML = `
    <div class="card analytics-shell">
      <div class="analytics-head">
        <div>
          <div class="card-title analytics-title">Data analytics</div>
          <div class="card-sub analytics-subtitle">Collection trends, loan category exposure, and payment status</div>
        </div>
        <label class="analytics-range"><span>Date range</span><select id="analyticsRangeSelect" aria-label="Analytics date range">
          <option value="year" ${analyticsRange==='year'?'selected':''}>This year</option>
          <option value="twelve_months" ${analyticsRange==='twelve_months'?'selected':''}>Last 12 months</option>
          <option value="six_months" ${analyticsRange==='six_months'?'selected':''}>Last 6 months</option>
          <option value="month" ${analyticsRange==='month'?'selected':''}>This month</option>
        </select></label>
      </div>

      <div class="analytics-grid">
        <div class="analytics-left">
          <div class="analytics-section-title"><span class="analytics-icon">▥</span>Collection trend</div>
          <div class="analytics-chart-card">
            ${buildAnalyticsLineChart(periods, releasesByMonth, collectionsByMonth)}
          </div>
        </div>

        <div class="analytics-right">
          <div class="analytics-section-title">Loan category</div>
          <div class="analytics-chart-card analytics-bar-card">
            ${buildAnalyticsBarChart(categories)}
          </div>

          <div class="analytics-divider"></div>

          <div class="analytics-section-title">Payment status</div>
          <div class="analytics-status-grid">
            ${statuses.map(s => `
              <div class="analytics-status-item">
                <div class="analytics-status-line" style="background:${s.color}"></div>
                <div class="analytics-status-count">${s.count}</div>
                <div class="analytics-status-label">${s.label}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('analyticsRangeSelect')?.addEventListener('change', e => {
    analyticsRange = e.target.value;
    renderDataAnalytics(document.getElementById('finAnalyticsPanel'));
  });
}

function buildAnalyticsLineChart(periods, releases, collections) {
  const width = 840;
  const height = 285;
  const pad = {l: 58, r: 18, t: 24, b: 45};
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const maxValue = Math.max(1, ...releases, ...collections);
  const pointsX = i => pad.l + (plotW * i / Math.max(1, periods.length - 1));
  const pointsY = v => pad.t + plotH - ((Number(v)||0) / maxValue) * plotH;
  const steps = 4;
  const grid = Array.from({length:steps+1}, (_,i) => {
    const value = maxValue * (steps-i)/steps;
    const y = pad.t + plotH * i/steps;
    return `<line x1="${pad.l}" y1="${y}" x2="${width-pad.r}" y2="${y}" stroke="#dfe9ef" stroke-dasharray="4 5"/>
      <text x="${pad.l-10}" y="${y+4}" text-anchor="end" class="analytics-axis-label">${escapeHtml(shortPeso(value))}</text>`;
  }).join('');

  const makePath = series => series.map((v,i) => `${i===0?'M':'L'} ${pointsX(i).toFixed(1)} ${pointsY(v).toFixed(1)}`).join(' ');
  const dots = (series,color) => series.map((v,i) => `<circle cx="${pointsX(i)}" cy="${pointsY(v)}" r="4" fill="#fff" stroke="${color}" stroke-width="3"><title>${escapeHtml(monthLabel(periods[i]))}: ${peso(v)}</title></circle>`).join('');
  const labels = periods.map((p,i) => `<text x="${pointsX(i)}" y="${height-15}" text-anchor="middle" class="analytics-axis-label">${escapeHtml(monthLabel(p))}</text>`).join('');

  return `<div class="analytics-line-wrap">
    <svg class="analytics-line-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Collection trend for ${escapeHtml(analyticsRangeLabel(analyticsRange))}">
      ${grid}
      <line x1="${pad.l}" y1="${pad.t+plotH}" x2="${width-pad.r}" y2="${pad.t+plotH}" stroke="#ccd9e1"/>
      <path d="${makePath(releases)}" fill="none" stroke="${ANALYTICS_COLORS.teal}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${makePath(collections)}" fill="none" stroke="${ANALYTICS_COLORS.green}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots(releases,ANALYTICS_COLORS.teal)}
      ${dots(collections,ANALYTICS_COLORS.green)}
      ${labels}
    </svg>
    <div class="analytics-legend">
      <span><i style="background:${ANALYTICS_COLORS.teal}"></i>Loan releases</span>
      <span><i style="background:${ANALYTICS_COLORS.green}"></i>Collections received</span>
    </div>
  </div>`;
}

function buildAnalyticsBarChart(categories) {
  const width = 470;
  const height = 230;
  const pad = {l: 38, r: 15, t: 18, b: 42};
  const plotW = width-pad.l-pad.r;
  const plotH = height-pad.t-pad.b;
  const max = Math.max(1, ...categories.map(x=>x.amount));
  const slot = categories.length ? plotW/categories.length : plotW;
  const barW = Math.min(110, slot*0.52);
  const grid = Array.from({length:4}, (_,i) => {
    const value=max*(i+1)/4;
    const y=pad.t+plotH-(plotH*(i+1)/4);
    return `<line x1="${pad.l}" y1="${y}" x2="${width-pad.r}" y2="${y}" stroke="#eef2f5"/><text x="${pad.l-8}" y="${y+4}" text-anchor="end" class="analytics-axis-label">${escapeHtml(shortPeso(value))}</text>`;
  }).join('');
  const bars=categories.map((item,i)=>{
    const cx=pad.l+slot*i+slot/2;
    const h=item.amount?Math.max(2,(item.amount/max)*plotH):2;
    const y=pad.t+plotH-h;
    return `<g><rect x="${cx-barW/2}" y="${y}" width="${barW}" height="${h}" rx="6" fill="${ANALYTICS_COLORS.teal}"><title>${escapeHtml(item.type)}: ${peso(item.amount)} outstanding</title></rect>
      <text x="${cx}" y="${Math.max(11,y-8)}" text-anchor="middle" class="analytics-bar-value">${escapeHtml(peso(item.amount))}</text>
      <text x="${cx}" y="${height-18}" text-anchor="middle" class="analytics-category-label">${escapeHtml(item.label)}</text></g>`;
  }).join('');
  return `<svg class="analytics-bar-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Outstanding balance by loan category">${grid}<line x1="${pad.l}" y1="${pad.t+plotH}" x2="${width-pad.r}" y2="${pad.t+plotH}" stroke="#d6e1e8"/>${bars}</svg>`;
}


/* ====================== FINANCIAL REPORTS ====================== */
let generatedReport = null;

const REPORT_TYPE_OPTIONS = [
  { value: 'collection', label: 'Collection Report' },
  { value: 'portfolio', label: 'Loan Portfolio Report' },
  { value: 'outstanding', label: 'Outstanding Balance Report' },
  { value: 'summary', label: 'Financial Summary Report' },
  { value: 'ledger', label: 'Loan Ledger Report' }
];

const REPORT_RANGE_OPTIONS = [
  { value: 'year', label: 'This year' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'month', label: 'This month' }
];

function reportRange(range) {
  const today = new Date(`${todayISO()}T00:00:00`);
  let start = new Date(today);
  if (range === '90d') start.setDate(start.getDate() - 89);
  if (range === 'month') start = new Date(today.getFullYear(), today.getMonth(), 1);
  if (range === 'year') start = new Date(today.getFullYear(), 0, 1);
  return { start: isoDateLocal(start), end: todayISO() };
}

function inReportRange(dateStr, range) {
  if (!dateStr) return false;
  const r = reportRange(range);
  const value = String(dateStr).slice(0, 10);
  return value >= r.start && value <= r.end;
}

function reportTypeLabel(value) {
  return REPORT_TYPE_OPTIONS.find(x => x.value === value)?.label || 'Financial Summary Report';
}

function reportRangeLabel(value) {
  return REPORT_RANGE_OPTIONS.find(x => x.value === value)?.label || 'This year';
}

function reportModel(type, range) {
  const portfolio = DATA.loans.filter(l => l.status !== 'rejected');
  const validPayments = activePayments();

  let reportLoans;
  if (type === 'outstanding') {
    reportLoans = portfolio.filter(l => l.status !== 'fully_paid');
  } else {
    reportLoans = portfolio.filter(l => inReportRange(l.startDate, range));
  }

  // If a period contains no new loans, keep the report useful by showing the active portfolio.
  if (!reportLoans.length && portfolio.length) {
    reportLoans = type === 'collection' || type === 'portfolio' || type === 'summary' || type === 'ledger'
      ? portfolio
      : reportLoans;
  }

  const reportPayments = validPayments.filter(p => inReportRange(p.date, range));
  const released = reportLoans.reduce((sum, l) => sum + Number(l.principal || 0), 0);
  const collections = reportPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const outstanding = portfolio.filter(l => l.status !== 'fully_paid')
    .reduce((sum, l) => sum + loanCalc(l).outstanding, 0);
  const interest = portfolio.reduce((sum, l) => sum + loanCalc(l).totalInterest, 0);

  const loanRows = reportLoans.map(l => ({
    loanNo: l.refId || l.id || '—',
    borrower: l.clientName || 'Borrower',
    category: l.type || 'Individual Loan',
    released: Number(l.principal || 0),
    repaid: loanCalc(l).totalCollection,
    balance: loanCalc(l).outstanding
  }));

  const collectionRows = reportPayments.map(p => {
    const loan = portfolio.find(l => l.id === p.loanId || l.refId === p.loanId);
    return {
      receiptNo: p.receiptNo || p.reference || p.orNumber || p.refId || p.id || '—',
      date: p.date,
      borrower: p.clientName || loan?.clientName || 'Borrower',
      loanId: loan?.refId || p.loanId || '—',
      method: p.method || '—',
      amount: Number(p.amount || 0)
    };
  });

  return {
    type,
    range,
    typeLabel: reportTypeLabel(type),
    rangeLabel: reportRangeLabel(range),
    reportNo: `FIN-${todayISO().slice(0,4)}-001`,
    issuedDate: todayISO(),
    preparedBy: CURRENT_USER?.fullName || CURRENT_USER?.email || 'System Administrator',
    classification: 'Official Record',
    released,
    collections,
    outstanding,
    interest,
    loanRows,
    collectionRows
  };
}

function reportPreviewHtml(model) {
  const focusCopy = {
    collection: 'Collection activity for the selected reporting period.',
    portfolio: 'Loan releases and portfolio balances for the selected reporting period.',
    outstanding: 'Current open receivables across the lending portfolio.',
    summary: 'Consolidated financial position for the selected reporting period.',
    ledger: 'Consolidated loan and payment activity for the selected reporting period.'
  }[model.type] || '';

  return `
    <div class="report-preview-sheet">
      <div class="report-preview-actions">
        <button class="btn btn-primary" type="button" onclick="printGeneratedReport(false)">▣ Print</button>
        <button class="btn btn-outline" type="button" onclick="printGeneratedReport(true)">⇩ Save as PDF</button>
      </div>

      <div class="report-preview-kicker">LA FAMILIA DAVID LENDING CORPORATION</div>
      <div class="report-preview-title">${escapeHtml(model.typeLabel)}</div>
      <div class="report-preview-period">Period: ${escapeHtml(model.rangeLabel)}</div>
      <div class="report-preview-rule"></div>

      <div class="report-preview-meta">
        <span>Report No. <b>${escapeHtml(model.reportNo)}</b></span>
        <span>Date Issued <b>${escapeHtml(formatDate(model.issuedDate))}</b></span>
        <span>Prepared By <b>${escapeHtml(model.preparedBy)}</b></span>
        <span>Classification <b>${escapeHtml(model.classification)}</b></span>
      </div>

      <div class="report-kpi-grid">
        <div><small>RELEASED CAPITAL</small><b>${peso(model.released)}</b></div>
        <div><small>COLLECTIONS RECEIVED</small><b>${peso(model.collections)}</b></div>
        <div><small>OUTSTANDING BALANCE</small><b>${peso(model.outstanding)}</b></div>
        <div><small>INTEREST RECEIVABLE</small><b>${peso(model.interest)}</b></div>
      </div>

      <div class="report-preview-note">${escapeHtml(focusCopy)}</div>
    </div>`;
}

function reportPrintHtml(model) {
  const loans = model.loanRows.length ? model.loanRows : [{ loanNo:'—', borrower:'No records', category:'—', released:0, repaid:0, balance:0 }];
  const collections = model.collectionRows.length ? model.collectionRows : [{ receiptNo:'—', date:'', borrower:'No records', loanId:'—', method:'—', amount:0 }];

  const loanTable = loans.map(row => `
    <tr>
      <td>${ledgerPrintEscaped(row.loanNo)}</td>
      <td>${ledgerPrintEscaped(row.borrower)}</td>
      <td>${ledgerPrintEscaped(row.category)}</td>
      <td class="num">${ledgerMoney2(row.released)}</td>
      <td class="num">${ledgerMoney2(row.repaid)}</td>
      <td class="num">${ledgerMoney2(row.balance)}</td>
    </tr>`).join('');

  const collectionTable = collections.map(row => `
    <tr>
      <td>${ledgerPrintEscaped(row.receiptNo)}</td>
      <td>${ledgerPrintEscaped(row.date ? ledgerDateShort(row.date) : '')}</td>
      <td>${ledgerPrintEscaped(row.borrower)}</td>
      <td>${ledgerPrintEscaped(row.loanId)}</td>
      <td>${ledgerPrintEscaped(row.method)}</td>
      <td class="num">${ledgerMoney2(row.amount)}</td>
    </tr>`).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${ledgerPrintEscaped(model.typeLabel)}</title>
<style>
@page{size:A4 portrait;margin:9mm}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:8px;background:#fff}
.sheet{width:100%;max-width:190mm;margin:0 auto}
.brand{text-align:center;margin-bottom:6px}
.brand .tiny{font-size:6px;letter-spacing:.6px;margin-bottom:1px}
.brand .corp{font-size:10px;font-weight:700;letter-spacing:.25px}
.brand .office{font-size:6px;margin-top:1px}
.brand .title{font-size:9px;font-weight:700;margin-top:4px}
.brand .period{font-size:7px;margin-top:2px}
.rule{border-top:1px solid #111;margin:6px 0}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:2px 14px;font-size:6.5px;margin:4px 0 7px}
.meta span{display:flex;justify-content:space-between;gap:8px}
.meta b{font-weight:700}
.section-title{border:1px solid #111;background:#f2f2f2;font-size:7px;font-weight:700;padding:3px 5px;margin-top:6px}
table{border-collapse:collapse;width:100%;font-size:6.7px}
th,td{border:1px solid #111;padding:3px 4px;line-height:1.15}
th{text-align:center;font-weight:700;background:#f8f8f8}
td.num{text-align:right}
.total-row td{font-weight:700}
.fin-table{margin-top:5px}
.fin-table td:first-child{font-weight:700;width:72%}
.signature-wrap{display:grid;grid-template-columns:1fr 1fr;gap:45px;margin:22px 18px 0}
.signature{border-top:1px solid #111;text-align:center;padding-top:3px;font-size:6.5px}
.footer{text-align:center;font-size:5.5px;margin-top:10px}
@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body>
<div class="sheet">
  <div class="brand">
    <div class="tiny">Official Financial Report</div>
    <div class="corp">LA FAMILIA DAVID LENDING CORPORATION</div>
    <div class="office">Cabanatuan City, Nueva Ecija, Philippines</div>
    <div class="title">CONSOLIDATED FINANCIAL AND LOAN PORTFOLIO REPORT</div>
    <div class="period">${ledgerPrintEscaped(model.typeLabel)} · ${ledgerPrintEscaped(model.rangeLabel)}</div>
  </div>
  <div class="rule"></div>
  <div class="meta">
    <span>Report No.: <b>${ledgerPrintEscaped(model.reportNo)}</b></span>
    <span>Date Issued: <b>${ledgerPrintEscaped(ledgerDateLong(model.issuedDate))}</b></span>
    <span>Prepared By: <b>${ledgerPrintEscaped(model.preparedBy)}</b></span>
    <span>Classification: <b>${ledgerPrintEscaped(model.classification)}</b></span>
  </div>

  <div class="section-title">A. LOAN PORTFOLIO REGISTER</div>
  <table><thead><tr><th>LOAN NO.</th><th>BORROWER</th><th>CATEGORY</th><th>RELEASED</th><th>REPAID</th><th>BALANCE</th></tr></thead><tbody>${loanTable}</tbody></table>

  <div class="section-title">B. COLLECTION RECEIPT REGISTER</div>
  <table><thead><tr><th>RECEIPT NO.</th><th>DATE</th><th>BORROWER</th><th>LOAN ID</th><th>METHOD</th><th>AMOUNT</th></tr></thead><tbody>${collectionTable}</tbody></table>

  <div class="section-title">C. FINANCIAL TOTALS</div>
  <table class="fin-table"><tbody>
    <tr><td>Total Released Principal</td><td class="num">${ledgerMoney2(model.released)}</td></tr>
    <tr><td>Total Collections Received</td><td class="num">${ledgerMoney2(model.collections)}</td></tr>
    <tr><td>Total Outstanding Balance</td><td class="num">${ledgerMoney2(model.outstanding)}</td></tr>
    <tr><td>Total Interest Receivable</td><td class="num">${ledgerMoney2(model.interest)}</td></tr>
  </tbody></table>

  <div class="signature-wrap">
    <div class="signature">Prepared By<br><b>${ledgerPrintEscaped(model.preparedBy)}</b><br>Loan Officer</div>
    <div class="signature">Certified Correct By<br><b>Authorized Management Signatory</b><br>Management</div>
  </div>
  <div class="footer">This is a system-generated official report. All figures are subject to verification against source records.</div>
</div>
<script>window.onload=function(){window.focus();setTimeout(function(){window.print()},350)};</script>
</body></html>`;
}

function renderFinancialReports(panel) {
  if (!panel) return;
  const currentType = generatedReport?.type || 'collection';
  const currentRange = generatedReport?.range || 'year';
  panel.innerHTML = `
    <div class="card financial-reports-card">
      <div class="financial-reports-head">
        <div>
          <div class="financial-reports-title">Printable reports</div>
          <div class="financial-reports-sub">Choose a report and date range, then generate a print-ready summary</div>
        </div>
      </div>
      <div class="financial-reports-body">
        <div class="financial-report-controls">
          <label class="report-label">REPORT TYPE</label>
          <select id="reportType">
            ${REPORT_TYPE_OPTIONS.map(o => `<option value="${o.value}" ${o.value===currentType?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}
          </select>

          <label class="report-label">DATE RANGE</label>
          <select id="reportRange">
            ${REPORT_RANGE_OPTIONS.map(o => `<option value="${o.value}" ${o.value===currentRange?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}
          </select>

          <button class="btn btn-dark btn-block report-generate-btn" type="button" id="btnGenerateReport">Generate Report</button>
          <button class="btn btn-outline btn-block report-view-btn" type="button" id="btnViewReport">View Report</button>
        </div>
        <div class="financial-report-preview" id="financialReportPreview">
          ${generatedReport ? reportPreviewHtml(generatedReport) : `
            <div class="report-empty-state">
              <div class="report-empty-icon">▤</div>
              <b>Select options to generate a report</b>
              <span>Your printable preview will appear here.</span>
            </div>`}
        </div>
      </div>
    </div>`;

  document.getElementById('btnGenerateReport')?.addEventListener('click', generateFinancialReport);
  document.getElementById('btnViewReport')?.addEventListener('click', viewGeneratedReport);
}

function generateFinancialReport() {
  const type = document.getElementById('reportType')?.value || 'collection';
  const range = document.getElementById('reportRange')?.value || 'year';
  generatedReport = reportModel(type, range);
  const preview = document.getElementById('financialReportPreview');
  if (preview) preview.innerHTML = reportPreviewHtml(generatedReport);
}

function viewGeneratedReport() {
  if (!generatedReport) {
    generateFinancialReport();
  }
  if (!generatedReport) return;
  const preview = document.getElementById('financialReportPreview');
  preview?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function printGeneratedReport() {
  if (!generatedReport) {
    generateFinancialReport();
  }
  if (!generatedReport) return;
  const win = window.open('', '_blank', 'width=1000,height=900');
  if (!win) {
    alert('Please allow pop-ups to print the report.');
    return;
  }
  win.document.open();
  win.document.write(reportPrintHtml(generatedReport));
  win.document.close();
}

function renderFinancials() {
  const portfolio = DATA.loans.filter(l => l.status !== 'rejected');
  const openLoans = portfolio.filter(l => l.status !== 'fully_paid');
  const validPayments = DATA.payments.filter(p => !p.voided);

  const released = portfolio.reduce((sum, l) => sum + Number(l.principal || 0), 0);
  const received = validPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const receivable = openLoans.reduce((sum, l) => sum + loanCalc(l).outstanding, 0);
  const interest = portfolio.reduce((sum, l) => sum + loanCalc(l).totalInterest, 0);

  const statGrid = document.getElementById('finStatGrid');
  const overview = document.getElementById('finOverviewPanel');
  const analyticsPanel = document.getElementById('finAnalyticsPanel');
  const reportsPanel = document.getElementById('finReportsPanel');
  const ledgerPanel = document.getElementById('finLedgerPanel');
  if (!statGrid || !overview || !analyticsPanel || !reportsPanel || !ledgerPanel) return;

  const currentTab = currentFinTab || 'overview';
  document.querySelectorAll('#finTabs .tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.fin === currentTab);
  });

  overview.hidden = currentTab !== 'overview';
  ledgerPanel.hidden = currentTab !== 'ledger';
  analyticsPanel.hidden = currentTab !== 'analytics';
  reportsPanel.hidden = currentTab !== 'reports';

  if (currentTab === 'ledger') {
    renderLoanLedger();
    return;
  }

  if (currentTab === 'analytics') {
    renderDataAnalytics(analyticsPanel);
    return;
  }

  if (currentTab === 'reports') {
    renderFinancialReports(reportsPanel);
    return;
  }

  const totalExpected = released + interest;
  const collectionRate = totalExpected > 0 ? Math.min(100, Math.round((received / totalExpected) * 100)) : 0;

  statGrid.innerHTML = `
    <div class="financial-stat-card">
      <div class="financial-stat-icon released-icon">↗</div>
      <div class="financial-stat-current">CURRENT</div>
      <div class="financial-stat-value">${peso(released)}</div>
      <div class="financial-stat-label">Total released capital</div>
      <div class="financial-stat-sub">Principal issued to date</div>
    </div>
    <div class="financial-stat-card">
      <div class="financial-stat-icon received-icon">↘</div>
      <div class="financial-stat-current">CURRENT</div>
      <div class="financial-stat-value">${peso(received)}</div>
      <div class="financial-stat-label">Total collections received</div>
      <div class="financial-stat-sub">Recorded borrower payments</div>
    </div>
    <div class="financial-stat-card">
      <div class="financial-stat-icon outstanding-icon">▱</div>
      <div class="financial-stat-current">CURRENT</div>
      <div class="financial-stat-value">${peso(receivable)}</div>
      <div class="financial-stat-label">Total outstanding balance</div>
      <div class="financial-stat-sub">Open loan receivables</div>
    </div>
    <div class="financial-stat-card">
      <div class="financial-stat-icon interest-icon">▤</div>
      <div class="financial-stat-current">CURRENT</div>
      <div class="financial-stat-value">${peso(interest)}</div>
      <div class="financial-stat-label">Total interest receivable</div>
      <div class="financial-stat-sub">Expected on recorded loans</div>
    </div>
  `;

  const events = [];
  portfolio.forEach(loan => {
    events.push({
      date: loan.startDate,
      reference: loan.refId,
      borrower: loan.clientName || 'Borrower',
      loanNo: loan.refId,
      transaction: 'Loan Release',
      amount: Number(loan.principal || 0),
      balance: Number(loan.principal || 0),
      kind: 'release',
      sortKey: String(loan.startDate || '')
    });
  });

  validPayments.forEach(payment => {
    const loan = portfolio.find(l => l.id === payment.loanId || l.refId === payment.loanId);
    const loanNo = loan?.refId || payment.loanId || '—';
    events.push({
      date: payment.date,
      reference: payment.receiptNo || payment.refId || payment.id || '—',
      borrower: payment.clientName || loan?.clientName || 'Borrower',
      loanNo,
      transaction: 'Monthly Payment',
      amount: Number(payment.amount || 0),
      balance: Number.isFinite(Number(payment.balanceAfterPayment))
        ? Number(payment.balanceAfterPayment)
        : (loan ? loanCalc(loan).outstanding : 0),
      kind: 'payment',
      sortKey: String(payment.date || '')
    });
  });

  events.sort((a, b) => {
    const dateCompare = String(b.sortKey).localeCompare(String(a.sortKey));
    if (dateCompare !== 0) return dateCompare;
    return String(b.reference).localeCompare(String(a.reference));
  });

  const visibleEvents = events.slice(0, 10);
  const countEl = document.getElementById('finEntryCount');
  if (countEl) countEl.textContent = `${events.length} ${events.length === 1 ? 'entry' : 'entries'}`;

  const body = document.getElementById('financialTransactionsBody');
  if (!body) return;
  body.innerHTML = visibleEvents.map(event => `
    <tr>
      <td>${escapeHtml(formatDate(event.date))}</td>
      <td class="financial-reference">${escapeHtml(event.reference)}</td>
      <td><b>${escapeHtml(event.borrower)}</b></td>
      <td class="financial-reference">${escapeHtml(event.loanNo)}</td>
      <td>${escapeHtml(event.transaction)}</td>
      <td class="financial-amount ${event.kind === 'payment' ? 'payment-amount' : 'release-amount'}">${peso(event.amount)}</td>
      <td class="financial-balance">${peso(event.balance)}</td>
    </tr>
  `).join('') || `<tr><td colspan="7"><div class="empty-state">No financial transactions yet.</div></td></tr>`;

  statGrid.dataset.collectionRate = String(collectionRate);
}

let selectedLedgerLoanId = null;

function ledgerPaymentsForLoan(loan) {
  return DATA.payments
    .filter(p => !p.voided && (p.loanId === loan.id || p.loanId === loan.refId))
    .sort((a,b) => String(a.date || '').localeCompare(String(b.date || '')));
}

function ledgerPaymentCount(loan) {
  const type = String(loan.type || '').toLowerCase();
  if (type.includes('group')) return 25;
  return Math.max(1, Math.round(Number(loan.term || 1) * 4));
}
function ledgerScheduleRowCount(loan) {
  const type = String(loan.type || '').toLowerCase();
  if (type.includes('salary')) return Math.max(1, Math.round(Number(loan.term || 1) * 2));
  return ledgerPaymentCount(loan);
}

function addMonthsSafe(dateStr, months) {
  const d = new Date(`${String(dateStr || '').slice(0,10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

function isoDateLocal(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function ledgerScheduleDates(loan, count) {
  const start = new Date(`${String(loan.startDate || '').slice(0,10)}T00:00:00`);
  if (Number.isNaN(start.getTime())) return Array.from({length: count}, () => '');
  const type = String(loan.type || '').toLowerCase();
  const dates = [];

  if (type.includes('salary')) {
    for (let i = 0; i < count; i++) {
      let candidate;
      if (i === 0) {
        // The salary ledger starts on the next scheduled 15th/last-day cycle.
        // Example: a July 31 grant starts with August 15.
        if (start.getDate() < 15) candidate = new Date(start.getFullYear(), start.getMonth(), 15);
        else candidate = new Date(start.getFullYear(), start.getMonth()+1, 15);
      } else {
        const prev = new Date(`${dates[i-1]}T00:00:00`);
        const prevDay = prev.getDate();
        if (prevDay < 20) candidate = new Date(prev.getFullYear(), prev.getMonth(), lastDayOfMonth(prev.getFullYear(), prev.getMonth()));
        else candidate = new Date(prev.getFullYear(), prev.getMonth()+1, 15);
      }
      dates.push(isoDateLocal(candidate));
    }
    return dates;
  }

  for (let i=1; i<=count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + (7 * i));
    dates.push(isoDateLocal(d));
  }
  return dates;
}

function ledgerRowsForLoan(loan) {
  const payments = ledgerPaymentsForLoan(loan);
  const count = Math.max(ledgerScheduleRowCount(loan), payments.length);
  const schedule = ledgerScheduleDates(loan, count);
  const totalInterest = Number(loan.totalInterest || 0) || Number(loan.principal || 0) * (Number(loan.rate || 0) / 100) * Number(loan.term || 0);
  const rows = [];
  let principalPaid = 0, interestPaid = 0, cbuPaid = 0, excess = 0;

  for (let i=0; i<count; i++) {
    const p = payments[i];
    const principalApplied = Number(p?.principalApplied || 0);
    const interestApplied = Number(p?.interestApplied || 0);
    const paymentAmount = Number(p?.amount || 0);
    const paymentExcess = Number(p?.excess || 0);
    const cbu = Number(p?.cbuApplied || 0);
    principalPaid += principalApplied;
    interestPaid += interestApplied;
    cbuPaid += cbu;
    excess += paymentExcess;
    const principalBalance = Math.max(0, Number(loan.principal || 0) - principalPaid);
    const interestBalance = Math.max(0, totalInterest - interestPaid);
    rows.push({
      no: i + 1,
      schedule: schedule[i] || '',
      actual: p?.date || '',
      paid: paymentAmount,
      principal: principalApplied,
      interest: interestApplied,
      cbu,
      excess: paymentExcess,
      principalBalance,
      interestBalance,
      balance: principalBalance + interestBalance,
      mode: p?.method || ''
    });
  }
  return {rows, totalInterest, principalPaid, interestPaid, cbuPaid, excess};
}

function renderLoanLedger() {
  const listEl = document.getElementById('ledgerLoanList');
  const detailEl = document.getElementById('ledgerDetail');
  const searchEl = document.getElementById('ledgerLoanSearch');
  if (!listEl || !detailEl) return;

  // Ledger is selected per loan/client record. Rejected loans are excluded.
  const loans = DATA.loans.filter(l => l.status !== 'rejected');
  const query = String(searchEl?.value || '').toLowerCase().trim();

  const filtered = loans.filter(l =>
    `${l.clientName || ''} ${l.refId || ''} ${l.type || ''}`
      .toLowerCase()
      .includes(query)
  );

  if (!selectedLedgerLoanId || !loans.some(l => l.id === selectedLedgerLoanId)) {
    selectedLedgerLoanId = loans[0]?.id || null;
  }

  if (filtered.length && !filtered.some(l => l.id === selectedLedgerLoanId)) {
    selectedLedgerLoanId = filtered[0].id;
  }

  listEl.innerHTML = filtered.map(l => `
    <button
      type="button"
      class="ledger-loan-item ${l.id === selectedLedgerLoanId ? 'active' : ''}"
      onclick="selectLedgerLoan('${escapeJs(l.id)}')"
    >
      <b>${escapeHtml(l.clientName || 'Borrower')}</b>
      <small>${escapeHtml(l.refId || l.id || '—')}</small>
    </button>
  `).join('') || `<div class="empty-state">No loans match your search.</div>`;

  const loan = loans.find(l => l.id === selectedLedgerLoanId);

  if (!loan) {
    detailEl.innerHTML = `<div class="empty-state">No loan ledger is available.</div>`;
    return;
  }

  const payments = [...ledgerPaymentsForLoan(loan)]
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  const totalInterest =
    Number(loan.totalInterest || 0) ||
    Number(loan.principal || 0) *
      (Number(loan.rate || 0) / 100) *
      Number(loan.term || 0);

  const totalPayable = Number(loan.principal || 0) + totalInterest;

  let runningBalance = totalPayable;

  const transactionRows = [
    {
      date: loan.startDate,
      reference: loan.refId || '—',
      description: 'Loan Release',
      debit: Number(loan.principal || 0),
      credit: 0,
      balance: totalPayable
    },
    ...payments.map((p) => {
      const amount = Number(p.amount || 0);
      runningBalance = Math.max(0, runningBalance - amount);

      return {
        date: p.date,
        reference: p.receiptNumber || p.reference || p.orNumber || '—',
        description: 'Monthly Payment',
        debit: 0,
        credit: amount,
        balance: runningBalance
      };
    })
  ];

  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const outstanding = loanCalc(loan).outstanding;

  detailEl.innerHTML = `
    <div class="ledger-detail-head">
      <div>
        <h2>${escapeHtml(loan.clientName || 'Borrower')}</h2>
        <span>${escapeHtml(loan.refId || '—')}</span>
      </div>

      <div class="ledger-summary-pills">
        <div>
          <small>PRINCIPAL</small>
          <b>${peso(loan.principal)}</b>
        </div>

        <div>
          <small>TOTAL PAID</small>
          <b class="ledger-paid">${peso(totalPaid)}</b>
        </div>

        <div>
          <small>OUTSTANDING</small>
          <b class="ledger-outstanding">${peso(outstanding)}</b>
        </div>
      </div>
    </div>

    <div class="ledger-transaction-wrap">
      <table class="ledger-transaction-table">
        <thead>
          <tr>
            <th>DATE</th>
            <th>REFERENCE</th>
            <th>DESCRIPTION</th>
            <th>DEBIT</th>
            <th>CREDIT</th>
            <th>BALANCE</th>
          </tr>
        </thead>

        <tbody>
          ${transactionRows.map((r) => `
            <tr>
              <td>${escapeHtml(formatDate(r.date))}</td>
              <td>${escapeHtml(r.reference)}</td>
              <td><b>${escapeHtml(r.description)}</b></td>
              <td>${r.debit ? peso(r.debit) : '—'}</td>
              <td class="${r.credit ? 'ledger-credit' : ''}">
                ${r.credit ? peso(r.credit) : '—'}
              </td>
              <td>${peso(r.balance)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function selectLedgerLoan(encodedId) {
  selectedLedgerLoanId = decodeURIComponent(String(encodedId || ''));
  renderLoanLedger();
}

function ledgerPrintEscaped(value) {
  return escapeHtml(value == null ? '' : value);
}

function ledgerMoney2(value, dashZero = false) {
  const n = Number(value || 0);
  if (dashZero && Math.abs(n) < 0.005) return '-';
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ledgerDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${String(dateStr).slice(0,10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
}

function ledgerDateLong(dateStr, period = false) {
  if (!dateStr) return '';
  const d = new Date(`${String(dateStr).slice(0,10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  const months = period
    ? ['Jan.','Feb.','Mar.','Apr.','May','Jun.','Jul.','Aug.','Sep.','Oct.','Nov.','Dec.']
    : ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function buildLedgerPrintHtml(loan) {
  const payments = [...ledgerPaymentsForLoan(loan)]
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  const type = String(loan.type || '').toLowerCase();
  const isBusiness = type.includes('business');
  const isGroup = type.includes('group');
  const isSalary = type.includes('salary');

  const totalInterest =
    Number(loan.totalInterest || 0) ||
    Number(loan.principal || 0) *
      (Number(loan.rate || 0) / 100) *
      Number(loan.term || 0);

  const totalPayable = Number(loan.principal || 0) + totalInterest;
  const numberOfPayments = isGroup
    ? 25
    : Math.max(1, Math.round(Number(loan.term || 1) * (isSalary ? 4 : 4)));
  const amortization = numberOfPayments > 0 ? totalPayable / numberOfPayments : totalPayable;
  const maturityDate = loan.dueDate || (() => {
    const d = addMonthsSafe(loan.startDate, Number(loan.term || 0));
    return d ? isoDateLocal(d) : '';
  })();

  const scheduleCount = Math.max(numberOfPayments, payments.length);
  const schedule = ledgerScheduleDates(loan, scheduleCount);

  let principalPaid = 0;
  let interestPaid = 0;
  let cbuPaid = 0;
  let laPaid = 0;
  let insurancePaid = 0;
  let excessPaid = 0;

  function n(value) {
    const v = Number(value);
    return Number.isFinite(v) ? v : 0;
  }

  function paymentCbu(payment) {
    return n(payment?.cbuApplied ?? payment?.cbu ?? 0);
  }

  function paymentLa(payment) {
    return n(payment?.laApplied ?? payment?.loanAvailmentApplied ?? 0);
  }

  function paymentInsurance(payment) {
    return n(payment?.insuranceApplied ?? 0);
  }

  const rows = Array.from({ length: scheduleCount }, (_, index) => {
    const p = payments[index];
    const principal = n(p?.principalApplied);
    const interest = n(p?.interestApplied);
    const cbu = paymentCbu(p);
    const la = paymentLa(p);
    const insurance = paymentInsurance(p);
    const amount = n(p?.amount);
    const excess = n(p?.excess);

    principalPaid += principal;
    interestPaid += interest;
    cbuPaid += cbu;
    laPaid += la;
    insurancePaid += insurance;
    excessPaid += excess;

    const outstandingPrincipal = Math.max(0, n(loan.principal) - principalPaid);
    const outstandingInterest = Math.max(0, totalInterest - interestPaid);
    const outstandingCbu = Math.max(0, n(loan.cbu) - cbuPaid);

    return {
      no: index + 1,
      schedule: schedule[index] || '',
      actual: p?.date || '',
      paid: amount,
      principal,
      interest,
      cbu,
      la,
      insurance,
      excessPyt: excess,
      excessBal: '',
      obPrincipal: outstandingPrincipal,
      obInterest: outstandingInterest,
      obCbu: outstandingCbu,
      mode: p?.method || ''
    };
  });

  function printCell(value, dashZero = false) {
    return ledgerMoney2(value, dashZero);
  }

  const tableColumnCount = isGroup ? 15 : isBusiness ? 14 : 11;

  const amountHeaders = isGroup
    ? '<th colspan="4" class="group-amount">AMOUNT</th>'
    : isBusiness
      ? '<th colspan="3" class="group-amount">AMOUNT</th>'
      : '<th colspan="2" class="group-amount">AMOUNT</th>';

  const excessHeaders = '<th colspan="2" class="group-excess">EXCESS</th>';
  const obHeaders = isGroup || isBusiness
    ? '<th colspan="3" class="group-ob">OB</th>'
    : '<th colspan="2" class="group-ob">OB</th>';

  const detailHeaders = isGroup
    ? `
      <tr>
        <th rowspan="2">NO.</th>
        <th rowspan="2">SCHEDULE OF<br>PAYMENT</th>
        <th rowspan="2">ACTUAL DATE</th>
        <th rowspan="2">PAID AMOUNT</th>
        ${amountHeaders}
        ${excessHeaders}
        ${obHeaders}
        <th rowspan="2">MODE<br>OF PYT</th>
      </tr>
      <tr class="subhead">
        <th>PRIN</th><th>INT</th><th>CBU</th><th>L A</th>
        <th>PYT</th><th>BAL</th>
        <th>PRIN</th><th>INT</th><th>CBU</th>
      </tr>`
    : isBusiness
      ? `
      <tr>
        <th rowspan="2">NO.</th>
        <th rowspan="2">SCHEDULE OF<br>PAYMENT</th>
        <th rowspan="2">ACTUAL DATE</th>
        <th rowspan="2">PAID AMOUNT</th>
        ${amountHeaders}
        ${excessHeaders}
        ${obHeaders}
        <th rowspan="2">INSURANCE</th>
        <th rowspan="2">MODE<br>OF PYT</th>
      </tr>
      <tr class="subhead">
        <th>PRIN</th><th>INT</th><th>CBU</th>
        <th>PYT</th><th>BAL</th>
        <th>PRIN</th><th>INT</th><th>CBU</th>
      </tr>`
      : `
      <tr>
        <th rowspan="2">NO.</th>
        <th rowspan="2">SCHEDULE OF<br>PAYMENT</th>
        <th rowspan="2">ACTUAL DATE</th>
        <th rowspan="2">PAID AMOUNT</th>
        ${amountHeaders}
        ${excessHeaders}
        ${obHeaders}
        <th rowspan="2">MODE<br>OF PYT</th>
      </tr>
      <tr class="subhead">
        <th>PRIN</th><th>INT</th>
        <th>PYT</th><th>BAL</th>
        <th>PRIN</th><th>INT</th>
      </tr>`;

  const bodyRows = rows.map(r => {
    if (isGroup) {
      return `
        <tr>
          <td>${r.no}</td>
          <td>${ledgerPrintEscaped(ledgerDateShort(r.schedule))}</td>
          <td>${ledgerPrintEscaped(ledgerDateShort(r.actual))}</td>
          <td>${r.paid ? printCell(r.paid) : '-'}</td>
          <td>${r.principal ? printCell(r.principal) : '-'}</td>
          <td>${r.interest ? printCell(r.interest) : '-'}</td>
          <td>${r.cbu ? printCell(r.cbu) : '-'}</td>
          <td>${r.la ? printCell(r.la) : '-'}</td>
          <td>${r.excessPyt ? printCell(r.excessPyt) : '-'}</td>
          <td>${r.excessBal ? printCell(r.excessBal) : '-'}</td>
          <td>${printCell(r.obPrincipal)}</td>
          <td>${printCell(r.obInterest)}</td>
          <td>${printCell(r.obCbu)}</td>
          <td>${ledgerPrintEscaped(r.mode || '')}</td>
        </tr>`;
    }

    if (isBusiness) {
      return `
        <tr>
          <td>${r.no}</td>
          <td>${ledgerPrintEscaped(ledgerDateShort(r.schedule))}</td>
          <td>${ledgerPrintEscaped(ledgerDateShort(r.actual))}</td>
          <td>${r.paid ? printCell(r.paid) : '-'}</td>
          <td>${r.principal ? printCell(r.principal) : '-'}</td>
          <td>${r.interest ? printCell(r.interest) : '-'}</td>
          <td>${r.cbu ? printCell(r.cbu) : '-'}</td>
          <td>${r.excessPyt ? printCell(r.excessPyt) : '-'}</td>
          <td>${r.excessBal ? printCell(r.excessBal) : '-'}</td>
          <td>${printCell(r.obPrincipal)}</td>
          <td>${printCell(r.obInterest)}</td>
          <td>${printCell(r.obCbu)}</td>
          <td>${r.insurance ? printCell(r.insurance) : '-'}</td>
          <td>${ledgerPrintEscaped(r.mode || '')}</td>
        </tr>`;
    }

    return `
      <tr>
        <td>${r.no}</td>
        <td>${ledgerPrintEscaped(ledgerDateShort(r.schedule))}</td>
        <td>${ledgerPrintEscaped(ledgerDateShort(r.actual))}</td>
        <td>${r.paid ? printCell(r.paid) : '-'}</td>
        <td>${r.principal ? printCell(r.principal) : '-'}</td>
        <td>${r.interest ? printCell(r.interest) : '-'}</td>
        <td>${r.excessPyt ? printCell(r.excessPyt) : '-'}</td>
        <td>${r.excessBal ? printCell(r.excessBal) : '-'}</td>
        <td>${printCell(r.obPrincipal)}</td>
        <td>${printCell(r.obInterest)}</td>
        <td>${ledgerPrintEscaped(r.mode || '')}</td>
      </tr>`;
  }).join('');

  const totalPaid = payments.reduce((sum, p) => sum + n(p.amount), 0);
  const outstanding = loanCalc(loan).outstanding;

  const totalRow = isGroup
    ? `<tr class="total-row">
        <td colspan="3"><b>NO. OF PAYMENTS MADE</b></td>
        <td><b>${payments.length}</b></td>
        <td><b>${printCell(principalPaid)}</b></td>
        <td><b>${printCell(interestPaid)}</b></td>
        <td><b>${printCell(cbuPaid)}</b></td>
        <td><b>${printCell(laPaid)}</b></td>
        <td><b>${printCell(excessPaid)}</b></td>
        <td><b>-</b></td>
        <td><b>${printCell(Math.max(0, n(loan.principal) - principalPaid))}</b></td>
        <td><b>${printCell(Math.max(0, totalInterest - interestPaid))}</b></td>
        <td><b>${printCell(Math.max(0, n(loan.cbu) - cbuPaid))}</b></td>
        <td></td>
      </tr>`
    : isBusiness
      ? `<tr class="total-row">
          <td colspan="3"><b>NO. OF PAYMENTS MADE</b></td>
          <td><b>${payments.length}</b></td>
          <td><b>${printCell(principalPaid)}</b></td>
          <td><b>${printCell(interestPaid)}</b></td>
          <td><b>${printCell(cbuPaid)}</b></td>
          <td><b>${printCell(excessPaid)}</b></td>
          <td><b>-</b></td>
          <td><b>${printCell(Math.max(0, n(loan.principal) - principalPaid))}</b></td>
          <td><b>${printCell(Math.max(0, totalInterest - interestPaid))}</b></td>
          <td><b>${printCell(Math.max(0, n(loan.cbu) - cbuPaid))}</b></td>
          <td><b>${printCell(insurancePaid)}</b></td>
          <td></td>
        </tr>`
      : `<tr class="total-row">
          <td colspan="3"><b>NO. OF PAYMENTS MADE</b></td>
          <td><b>${payments.length}</b></td>
          <td><b>${printCell(principalPaid)}</b></td>
          <td><b>${printCell(interestPaid)}</b></td>
          <td><b>${printCell(excessPaid)}</b></td>
          <td><b>-</b></td>
          <td><b>${printCell(Math.max(0, n(loan.principal) - principalPaid))}</b></td>
          <td><b>${printCell(Math.max(0, totalInterest - interestPaid))}</b></td>
          <td></td>
        </tr>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Client's Ledger - ${ledgerPrintEscaped(loan.clientName || '')}</title>
<style>
  @page { size: A4 landscape; margin: 8mm 8mm 10mm; }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#10192b;font-family:Arial,Helvetica,sans-serif}
  body{font-size:8px}
  .sheet{width:100%;max-width:278mm;margin:0 auto}
  .title{text-align:center;font-size:16px;font-weight:700;line-height:1.15}
  .subtitle{text-align:center;font-size:9px;font-weight:700;margin:2px 0 9px}
  .title-rule{height:1.5px;background:#17253a;margin-bottom:7px}
  .info-grid{display:grid;grid-template-columns:1.55fr 1.05fr 1fr;gap:4px;margin-bottom:7px}
  .info-box{border:1px solid #1c2b40;min-height:54px}
  .info-row{display:grid;grid-template-columns:44% 56%;min-height:18px}
  .info-row>div{padding:4px 5px;border-bottom:1px solid #c9d1db}
  .info-row>div:first-child{font-weight:700;border-right:1px solid #c9d1db}
  .info-row:last-child>div{border-bottom:0}
  .field-label{font-weight:700}
  .field-value{font-weight:600}
  .value-red{color:#e00000}
  .frequency{font-weight:700}
  .ledger-table{width:100%;border-collapse:collapse;table-layout:fixed}
  .ledger-table th,.ledger-table td{border:1px solid #162238;padding:3px 4px;text-align:center;vertical-align:middle}
  .ledger-table th{font-size:6.7px;font-weight:700;background:#f3f7fa}
  .ledger-table .subhead th{font-size:6.5px;background:#fff}
  .group-amount{background:#fff500!important}
  .group-excess{background:#dcecf5!important}
  .group-ob{background:#ffc000!important}
  .ledger-table td{font-size:7.1px;height:18px}
  .ledger-table td:nth-child(2),.ledger-table td:nth-child(3){white-space:nowrap}
  .ledger-table td:nth-last-child(1){font-size:6.9px}
  .total-row td{background:#07256a;color:#fff;font-weight:700;height:20px}
  .total-row td:nth-child(n){border-color:#142546}
  .signature-grid{display:grid;grid-template-columns:1fr 1fr;gap:65px;margin-top:12px}
  .signature{border-top:1px solid #182438;text-align:center;padding-top:4px;font-size:7px}
  .note{text-align:center;color:#7f8b9c;font-size:6.5px;margin-top:10px}
  .meta-strip{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;margin-bottom:7px}
  .meta-chip{border:1px solid #c8d2dd;padding:4px 6px}
  .meta-chip .k{display:block;font-size:6px;font-weight:700;color:#64758a;text-transform:uppercase}
  .meta-chip .v{display:block;font-weight:700;font-size:8px;margin-top:2px}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="sheet">
  <div class="title">CLIENT'S LEDGER</div>
  <div class="subtitle">LOAN PAYMENT RECORD</div>
  <div class="title-rule"></div>

  <div class="info-grid">
    <div class="info-box">
      <div class="info-row"><div class="field-label">CLIENT'S NAME</div><div class="field-value">${ledgerPrintEscaped(loan.clientName || '—')}</div></div>
      <div class="info-row"><div class="field-label">PRINCIPAL</div><div class="field-value value-red">${ledgerMoney2(loan.principal)}</div></div>
      <div class="info-row"><div class="field-label">TOTAL INTEREST</div><div class="field-value value-red">${ledgerMoney2(totalInterest)}</div></div>
      <div class="info-row"><div class="field-label">DATE GRANTED</div><div class="field-value">${ledgerPrintEscaped(ledgerDateLong(loan.startDate))}</div></div>
      <div class="info-row"><div class="field-label">RATE</div><div class="field-value value-red">${ledgerMoney2(Number(loan.rate || 0), false)}%</div></div>
      <div class="info-row"><div class="field-label">NO. OF MONTHS</div><div class="field-value value-red">${Number(loan.term || 0)}</div></div>
    </div>

    <div class="info-box">
      <div class="info-row"><div class="field-label">LOAN TYPE</div><div class="field-value value-red">${ledgerPrintEscaped(String(loan.type || '—').toUpperCase())}</div></div>
      <div class="info-row"><div class="field-label">TOTAL PAYABLE</div><div class="field-value value-red">${ledgerMoney2(totalPayable)}</div></div>
      <div class="info-row"><div class="field-label">MATURITY DATE</div><div class="field-value">${ledgerPrintEscaped(ledgerDateLong(maturityDate))}</div></div>
      <div class="info-row"><div class="field-label">AMORTIZATION</div><div class="field-value value-red">${ledgerMoney2(amortization)}</div></div>
      <div class="info-row"><div class="field-label">NO. OF PAYMENTS</div><div class="field-value value-red">${numberOfPayments}</div></div>
      <div class="info-row"><div class="field-label">FREQUENCY</div><div class="field-value frequency">${isSalary ? '15 / 31' : 'WEEKLY'}</div></div>
    </div>

    <div class="info-box">
      <div class="info-row"><div class="field-label">LOAN REFERENCE</div><div class="field-value">${ledgerPrintEscaped(loan.refId || '—')}</div></div>
      <div class="info-row"><div class="field-label">TOTAL PAID</div><div class="field-value">${ledgerMoney2(totalPaid)}</div></div>
      <div class="info-row"><div class="field-label">OUTSTANDING</div><div class="field-value value-red">${ledgerMoney2(outstanding)}</div></div>
      <div class="info-row"><div class="field-label">STATUS</div><div class="field-value">${ledgerPrintEscaped(labelStatus(loan.status))}</div></div>
      <div class="info-row"><div class="field-label">BALANCE PRINCIPAL</div><div class="field-value">${ledgerMoney2(Math.max(0, n(loan.principal) - principalPaid))}</div></div>
      <div class="info-row"><div class="field-label">BALANCE INTEREST</div><div class="field-value">${ledgerMoney2(Math.max(0, totalInterest - interestPaid))}</div></div>
    </div>
  </div>

  <table class="ledger-table">
    <thead>${detailHeaders}</thead>
    <tbody>${bodyRows}</tbody>
    <tfoot>${totalRow}</tfoot>
  </table>

  <div class="signature-grid">
    <div class="signature">Borrower / Client Signature</div>
    <div class="signature">Collector / Authorized Personnel</div>
  </div>

  <div class="note">
    This ledger is generated for ${ledgerPrintEscaped(loan.clientName || 'the selected client')} and reflects the recorded loan payment history.
  </div>
</div>
<script>window.onload=()=>setTimeout(()=>window.print(),300);<\/script>
</body>
</html>`;
}

function printLoanLedger() {
  const loan = DATA.loans.find(l => l.id === selectedLedgerLoanId);
  if (!loan) { alert('Please select a loan first.'); return; }
  const win = window.open('', '_blank', 'width=1200,height=800');
  if (!win) { alert('Please allow pop-ups for the ledger PDF print window.'); return; }
  win.document.open();
  win.document.write(buildLedgerPrintHtml(loan));
  win.document.close();
}

const ledgerSearchInput = document.getElementById('ledgerLoanSearch');
if (ledgerSearchInput) ledgerSearchInput.addEventListener('input', renderLoanLedger);
const printLedgerBtn = document.getElementById('btnPrintLedger');
if (printLedgerBtn) printLedgerBtn.addEventListener('click', printLoanLedger);

/* Financial exports use the browser print engine so the user can choose Save as PDF. */

/* ====================== SETTINGS ====================== */
function formatAccountCreated() {
  const user = firebaseAuthInstance.currentUser;
  const raw = user?.metadata?.creationTime;
  if (!raw) return '—';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-PH', {year:'numeric', month:'long', day:'numeric'});
}

function recentAccountActivities() {
  const items = [];
  [...DATA.payments]
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))
    .forEach(p => items.push({
      icon:'✓', text:`Recorded payment for ${p.clientName || 'borrower'}`, date:p.date, amount:p.amount
    }));
  [...DATA.loans]
    .sort((a,b)=>String(b.startDate||'').localeCompare(String(a.startDate||'')))
    .forEach(l => items.push({
      icon:'✓', text:`Created loan record ${l.refId || l.id}`, date:l.startDate, amount:null
    }));
  return items.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
}

function openActivityModal() {
  const activities = recentAccountActivities();
  openModal(`
    <button class="modal-close" onclick="closeModal()">✕</button>
    <h2>Recent Activity</h2>
    <div class="staff-activity-list">${activities.map(a=>`
      <div class="staff-activity-item"><span class="activity-check">${a.icon}</span><div><b>${escapeHtml(a.text)}</b><small>${formatDate(a.date)}${a.amount!=null ? ' · '+peso(a.amount) : ''}</small></div></div>`).join('') || '<div class="empty-state">No recent activity.</div>'}</div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="closeModal()">Close</button></div>
  `);
}

function openAddStaffModal() {
  if (!isAdmin()) { alert('Only an administrator can create staff accounts.'); return; }
  openModal(`
    <div class="form-modal-header">
      <div>
        <h2>Add New Staff</h2>
        <p>Enter the staff account details for this user.</p>
      </div>
      <button class="modal-close" type="button" onclick="closeModal()" aria-label="Close">×</button>
    </div>

    <div class="form-modal-body">
      <div class="form-modal-grid">

        <div>
          <label class="field-label">Full Name *</label>
          <input id="staffFullName" type="text" maxlength="150" placeholder="Jean Gabriel" autocomplete="name">
        </div>

        <div>
          <label class="field-label">Login Email *</label>
          <input id="staffEmail" type="email" maxlength="254" placeholder="staff@davidlending.com" autocomplete="off">
        </div>

        <div>
          <label class="field-label">Password *</label>
          <input id="staffPassword" type="password" minlength="8" autocomplete="new-password" placeholder="Minimum 8 characters">
        </div>

        <div>
          <label class="field-label">Confirm Password *</label>
          <input id="staffPassword2" type="password" minlength="8" autocomplete="new-password" placeholder="Re-enter password">
        </div>

      </div>

      <div class="form-modal-note">
        Only an administrator can create staff login credentials. The email and password entered here become the staff member's Firebase login credentials.
      </div>

      <div id="staffCreateError" class="form-modal-error"></div>
    </div>

    <div class="form-modal-footer">
      <button class="modal-secondary" type="button" onclick="closeModal()">Cancel</button>
      <button class="modal-primary" type="button" id="saveStaffBtn" onclick="createStaffAccount()">Save Staff</button>
    </div>
  `, 'design-form-modal staff-form-modal');
}

async function createStaffAccount() {
  if (!isAdmin()) { alert('Only an administrator can create staff accounts.'); return; }
  const fullName = document.getElementById('staffFullName').value.trim();
  const email = document.getElementById('staffEmail').value.trim();
  const password = document.getElementById('staffPassword').value;
  const password2 = document.getElementById('staffPassword2').value;
  const error = document.getElementById('staffCreateError');
  if (!fullName || !email || !password || !password2) { error.textContent='Please complete all required fields.'; error.classList.add('show'); return; }
  if (!/^\S+@\S+\.\S+$/.test(email)) { error.textContent='Please enter a valid email address.'; error.classList.add('show'); return; }
  if (password.length < 8) { error.textContent='Password must be at least 8 characters.'; error.classList.add('show'); return; }
  if (password !== password2) { error.textContent='Passwords do not match.'; error.classList.add('show'); return; }

  const btn = document.getElementById('saveStaffBtn');
  btn.disabled = true; btn.textContent = 'Saving...';
  error.classList.remove('show');
  try {
    await api.post('/auth/register', { fullName, email, password, requestedRole:'STAFF' });
    closeModal();
    alert(`Staff account created successfully.\n\nLogin email: ${email}\nRole: STAFF\n\nGive the staff member these credentials securely.`);
    renderStaffAccount();
  } catch (err) {
    error.textContent = err.message || 'Could not create staff account.';
    error.classList.add('show');
    btn.disabled = false; btn.textContent = 'Save Staff';
  }
}

async function renderStaffAccount(){
  const root=document.getElementById('staffAccountBody');
  if(!root) return;
  const current = firebaseAuthInstance.currentUser;
  let profile = {
    fullName: CURRENT_USER?.fullName || current?.displayName || current?.email || 'User Account',
    email: CURRENT_USER?.email || current?.email || '',
    role: CURRENT_USER?.role || 'STAFF',
    active: true,
    createdAt: null
  };

  // When an administrator opens Staff Account, show the first active STAFF profile;
  // a staff member sees their own profile. This keeps the screen aligned with the
  // reference while still using live account data.
  if (isAdmin()) {
    try {
      const users = await api.get('/users');
      const staffUsers = (users || []).filter(u => u.role === 'STAFF' && u.active !== false);
      if (staffUsers.length) profile = staffUsers[0];
    } catch (err) {
      // Keep the current profile as a safe fallback if the directory request fails.
    }
  }

  const profileName = profile.fullName || profile.name || current?.email || 'User Account';
  const profileEmail = profile.email || current?.email || '—';
  const username = profile.username || String(profileEmail).split('@')[0] || '—';
  const creationRaw = profile.createdAt || profile.created_at || profile.accountCreated || profile.createdDate || null;
  const creationDate = creationRaw ? formatDate(String(creationRaw).slice(0,10)) : formatAccountCreated();
  const isProfileStaff = String(profile.role || '').toUpperCase() === 'STAFF';
  const roleLabel = isProfileStaff ? 'Loan Officer' : 'Administrator';
  const activities = recentAccountActivities();

  root.innerHTML = `
    <div class="staff-profile-card card">
      <div class="staff-profile-top">
        <div class="staff-person">
          <div class="staff-avatar-large">${escapeHtml(initials(profileName))}</div>
          <div>
            <h2>${escapeHtml(profileName)}</h2>
            <div class="staff-role">${escapeHtml(roleLabel)}</div>
            <span class="staff-status"><span>●</span> Active</span>
          </div>
        </div>
        <button class="btn btn-primary staff-edit-btn" type="button" id="btnViewAllStaff">☷ &nbsp; View All Staff</button>
      </div>
      <div class="staff-profile-info staff-profile-info-three">
        <div><span>✉ &nbsp;Email</span><b>${escapeHtml(profileEmail)}</b></div>
        <div><span>♙ &nbsp;Username</span><b>${escapeHtml(username)}</b></div>
        <div><span>◷ &nbsp;Account Created</span><b>${escapeHtml(creationDate)}</b></div>
      </div>
    </div>

    <div class="staff-two-col">
      <div class="card">
        <div class="staff-card-heading">Security</div>
        <button class="staff-add-security-btn" id="btnAddStaffSecurity" type="button">
          <span class="staff-add-security-icon">＋</span>
          <span><b>Add Staff</b><small>Create a new staff login account</small></span>
          <span class="staff-chevron">›</span>
        </button>
        <div class="staff-security-row">
          <span class="security-icon security-green">✓</span><span><b>Two-Factor Authentication</b></span><span class="enabled-badge">Enabled</span>
        </div>
      </div>

      <div class="card">
        <div class="staff-card-heading staff-activity-heading"><span>Recent Activity</span><button class="text-link" onclick="openActivityModal()">View Activity</button></div>
        <div class="staff-activity-list">
          ${activities.map(a=>`<div class="staff-activity-item"><span class="activity-check">${a.icon}</span><div><b>${escapeHtml(a.text)}</b><small>${formatDate(a.date)}</small></div>${a.amount!=null ? `<strong>${peso(a.amount)}</strong>` : ''}</div>`).join('') || '<div class="empty-state">No recent activity.</div>'}
        </div>
      </div>
    </div>
  `;

  document.getElementById('btnViewAllStaff')?.addEventListener('click', openViewAllStaffModal);
  document.getElementById('btnAddStaffSecurity')?.addEventListener('click', openAddStaffModal);
}


async function openViewAllStaffModal() {
  if (!isAdmin()) { alert('Only an administrator can switch between staff profiles.'); return; }

  openModal(`
    <button class="modal-close" type="button" onclick="closeModal()">✕</button>
    <h2>View All Staff</h2>
    <p class="modal-subtitle">Select a staff member to display their account information.</p>
    <div id="staffDirectoryPicker" class="staff-directory-picker">
      <div class="empty-state">Loading staff accounts…</div>
    </div>
  `);

  const picker = document.getElementById('staffDirectoryPicker');
  try {
    const users = await api.get('/users');
    const staffUsers = (users || []).filter(u => u.role === 'STAFF' && u.active !== false);

    if (!staffUsers.length) {
      picker.innerHTML = '<div class="empty-state">No active staff accounts are available.</div>';
      return;
    }

    picker.innerHTML = staffUsers.map((u, index) => {
      const name = u.fullName || u.name || u.email || 'Staff Member';
      const email = u.email || '—';
      const createdRaw = u.createdAt || u.created_at || u.accountCreated || u.createdDate || null;
      const created = createdRaw ? formatDate(String(createdRaw).slice(0,10)) : '—';
      const selected = index === 0;
      return `
        <button class="staff-directory-select ${selected ? 'selected' : ''}" type="button" data-staff-index="${index}">
          <span class="staff-directory-avatar">${escapeHtml(initials(name))}</span>
          <span class="staff-directory-main">
            <b>${escapeHtml(name)}</b>
            <small>${escapeHtml(email)}</small>
          </span>
          <span class="staff-directory-meta">
            <span>Loan Officer</span>
            <small>${escapeHtml(created)}</small>
          </span>
          <span class="staff-directory-arrow">›</span>
        </button>`;
    }).join('');

    picker.querySelectorAll('.staff-directory-select').forEach(btn => {
      btn.addEventListener('click', () => {
        picker.querySelectorAll('.staff-directory-select').forEach(x => x.classList.remove('selected'));
        btn.classList.add('selected');
        const staff = staffUsers[Number(btn.dataset.staffIndex)];
        renderSelectedStaffProfile(staff);
        closeModal();
      });
    });
  } catch (err) {
    picker.innerHTML = `<div class="empty-state">Could not load staff accounts: ${escapeHtml(err.message)}</div>`;
  }
}

function renderSelectedStaffProfile(profile) {
  const root = document.getElementById('staffAccountBody');
  if (!root || !profile) return;

  const profileName = profile.fullName || profile.name || profile.email || 'Staff Member';
  const profileEmail = profile.email || '—';
  const username = profile.username || String(profileEmail).split('@')[0] || '—';
  const creationRaw = profile.createdAt || profile.created_at || profile.accountCreated || profile.createdDate || null;
  const creationDate = creationRaw ? formatDate(String(creationRaw).slice(0,10)) : '—';
  const activities = recentAccountActivities();

  root.innerHTML = `
    <div class="staff-profile-card card">
      <div class="staff-profile-top">
        <div class="staff-person">
          <div class="staff-avatar-large">${escapeHtml(initials(profileName))}</div>
          <div>
            <h2>${escapeHtml(profileName)}</h2>
            <div class="staff-role">Loan Officer</div>
            <span class="staff-status"><span>●</span> Active</span>
          </div>
        </div>
        <button class="btn btn-primary staff-edit-btn" type="button" id="btnViewAllStaff">☷ &nbsp; View All Staff</button>
      </div>
      <div class="staff-profile-info staff-profile-info-three">
        <div><span>✉ &nbsp;Email</span><b>${escapeHtml(profileEmail)}</b></div>
        <div><span>♙ &nbsp;Username</span><b>${escapeHtml(username)}</b></div>
        <div><span>◷ &nbsp;Account Created</span><b>${escapeHtml(creationDate)}</b></div>
      </div>
    </div>

    <div class="staff-two-col">
      <div class="card">
        <div class="staff-card-heading">Security</div>
        <button class="staff-add-security-btn" id="btnAddStaffSecurity" type="button">
          <span class="staff-add-security-icon">＋</span>
          <span><b>Add Staff</b><small>Create a new staff login account</small></span>
          <span class="staff-chevron">›</span>
        </button>
        <div class="staff-security-row">
          <span class="security-icon security-green">✓</span><span><b>Two-Factor Authentication</b></span><span class="enabled-badge">Enabled</span>
        </div>
      </div>

      <div class="card">
        <div class="staff-card-heading staff-activity-heading"><span>Recent Activity</span><button class="text-link" type="button" onclick="openActivityModal()">View Activity</button></div>
        <div class="staff-activity-list">
          ${activities.map(a=>`<div class="staff-activity-item"><span class="activity-check">${a.icon}</span><div><b>${escapeHtml(a.text)}</b><small>${formatDate(a.date)}</small></div>${a.amount!=null ? `<strong>${peso(a.amount)}</strong>` : ''}</div>`).join('') || '<div class="empty-state">No recent activity.</div>'}
        </div>
      </div>
    </div>
  `;

  document.getElementById('btnViewAllStaff')?.addEventListener('click', openViewAllStaffModal);
  document.getElementById('btnAddStaffSecurity')?.addEventListener('click', openAddStaffModal);
}


let selectedLoanRuleCategory = 'Business Loan';

function formatSettingsTimestamp() {
  const d = new Date();
  return d.toLocaleDateString('en-PH', { month: 'short', day: '2-digit', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function selectLoanRuleCategory(category) {
  selectedLoanRuleCategory = category;
  document.querySelectorAll('#loanRuleCategorySelector .category-button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });
  const rule = loanRuleFor(category);
  const interest = document.getElementById('ruleInterestRate');
  const minTerm = document.getElementById('ruleMinTerm');
  const maxTerm = document.getElementById('ruleMaxTerm');
  if (interest) interest.value = rule.interestRate;
  if (minTerm) minTerm.value = rule.minTerm;
  if (maxTerm) maxTerm.value = rule.maxTerm;
  const name = document.getElementById('selectedRuleName');
  if (name) name.textContent = category.toUpperCase();
}

function renderLoanTypesList() {
  const list = document.getElementById('loanTypesList');
  if (!list) return;
  const types = DATA.settings.loanTypes || [];
  list.innerHTML = types.map(type => {
    const rule = loanRuleFor(type);
    return `<div class="managed-loan-type-row">
      <div><b>${escapeHtml(type)}</b><small>Terms: ${rule.minTerm}–${rule.maxTerm} months</small></div>
      <div class="managed-loan-type-actions">
        <button type="button" title="Edit loan rules" onclick="openLoanRuleEditor('${encodeURIComponent(type)}')">⌕</button>
        <button type="button" title="Remove loan type" onclick="removeLoanTypeByName('${encodeURIComponent(type)}')">♙</button>
      </div>
    </div>`;
  }).join('');
}

function renderSettings() {
  const s = DATA.settings;
  s.loanRules = s.loanRules || readStoredLoanRules();
  (s.loanTypes || []).forEach(type => loanRuleFor(type));

  const company = document.getElementById('setCompanyName');
  const tin = document.getElementById('setTIN');
  const address = document.getElementById('setAddress');
  if (company) company.value = s.companyName || '';
  if (tin) tin.value = s.tin || '';
  if (address) address.value = s.address || '';
  const settingsUpdated = document.getElementById('settingsUpdatedAt');
  if (settingsUpdated) settingsUpdated.textContent = formatSettingsTimestamp();
  const penalty = document.getElementById('setPenaltyRate');
  const grace = document.getElementById('setGracePeriod');
  const auto = document.getElementById('setAutoBackup');
  const autoVisible = document.getElementById('setAutoBackupVisible');
  if (penalty) penalty.value = s.penaltyRate;
  if (grace) grace.value = s.gracePeriod;
  if (auto) auto.checked = !!s.autoBackup;
  if (autoVisible) autoVisible.checked = !!s.autoBackup;
  const autoBusiness = document.getElementById('setAutoBackup');
  if (autoBusiness) autoBusiness.checked = !!s.autoBackup;

  selectLoanRuleCategory(s.loanRules[selectedLoanRuleCategory] ? selectedLoanRuleCategory : 'Business Loan');
  renderLoanTypesList();
  const stamp = formatSettingsTimestamp();
  const a = document.getElementById('loanRulesUpdated');
  const b = document.getElementById('loanTypesUpdated');
  if (a) a.textContent = stamp;
  if (b) b.textContent = stamp;

  document.querySelectorAll('[data-settings-tab]').forEach(tab => {
    if (tab.dataset.bound === '1') return;
    tab.dataset.bound = '1';
    tab.addEventListener('click', () => {
      const key = tab.dataset.settingsTab;
      document.querySelectorAll('#view-settings [data-settings-tab]').forEach(t => t.classList.toggle('active', t.dataset.settingsTab === key));
      document.querySelectorAll('#view-settings .settings-panel').forEach(panel => panel.classList.toggle('active', panel.id === 'settings-panel-' + key));
      if (key === 'business') {
        const s = DATA.settings;
        const company = document.getElementById('setCompanyName');
        const tin = document.getElementById('setTIN');
        const address = document.getElementById('setAddress');
        if (company) company.value = s.companyName || '';
        if (tin) tin.value = s.tin || '';
        if (address) address.value = s.address || '';
      }
    });
  });

  document.querySelectorAll('#loanRuleCategorySelector .category-button').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => selectLoanRuleCategory(btn.dataset.category));
  });
  syncSecuritySettingsUI();
  bindSecuritySettings();
}

function openLoanRuleEditor(encodedType) {
  const type = decodeURIComponent(encodedType || '');
  const rule = loanRuleFor(type);
  openModal(`
    <div class="loan-rule-editor">
      <button class="modal-close" type="button" onclick="closeModal()">×</button>
      <div class="editor-eyebrow">LOAN RULES</div>
      <h2>${escapeHtml(type)}</h2>
      <p>Update the category-specific interest rate and allowed term range.</p>
      <label class="field-label">INTEREST RATE (%)</label>
      <input id="editRuleInterest" type="number" min="0" step="0.01" value="${rule.interestRate}">
      <div class="editor-two-col">
        <div><label class="field-label">MIN TERM (MONTHS)</label><input id="editRuleMin" type="number" min="1" max="360" value="${rule.minTerm}"></div>
        <div><label class="field-label">MAX TERM (MONTHS)</label><input id="editRuleMax" type="number" min="1" max="360" value="${rule.maxTerm}"></div>
      </div>
      <div class="modal-actions"><button class="btn btn-outline" type="button" onclick="closeModal()">Cancel</button><button class="btn btn-primary" type="button" onclick="saveLoanRuleEditor('${encodeURIComponent(type)}')">Save</button></div>
    </div>
  `, 'loan-rule-editor-modal');
}

function saveLoanRuleEditor(encodedType) {
  const type = decodeURIComponent(encodedType || '');
  const interest = Number(document.getElementById('editRuleInterest')?.value);
  const minTerm = Number(document.getElementById('editRuleMin')?.value);
  const maxTerm = Number(document.getElementById('editRuleMax')?.value);
  if (!Number.isFinite(interest) || interest < 0 || !Number.isInteger(minTerm) || minTerm < 1 || !Number.isInteger(maxTerm) || maxTerm < minTerm) {
    alert('Please enter valid loan rule values.');
    return;
  }
  DATA.settings.loanRules[type] = { interestRate: interest, minTerm, maxTerm };
  persistLoanRules();
  if (type === selectedLoanRuleCategory) selectLoanRuleCategory(type);
  renderLoanTypesList();
  closeModal();
}

async function removeLoanTypeByName(encodedType) {
  const type = decodeURIComponent(encodedType || '');
  if (!type) return;
  if (['Business Loan','Salary Loan','Group Loan'].includes(type)) {
    alert('Business Loan, Salary Loan, and Group Loan are the three core loan categories and cannot be removed.');
    return;
  }
  await removeLoanType((DATA.settings.loanTypes || []).indexOf(type));
}

async function removeLoanType(i) {
  if (!Number.isInteger(i) || i < 0 || i >= DATA.settings.loanTypes.length) return;
  const removed = DATA.settings.loanTypes.splice(i, 1)[0];
  const removedRule = { ...(DATA.settings.loanRules[removed] || loanRuleFor(removed)) };
  delete DATA.settings.loanRules[removed];
  try {
    await persistSettings();
    persistLoanRules();
    if (selectedLoanRuleCategory === removed) selectedLoanRuleCategory = 'Business Loan';
    renderSettings();
  } catch (err) {
    DATA.settings.loanTypes.splice(i, 0, removed);
    DATA.settings.loanRules[removed] = removedRule;
    persistLoanRules();
    alert(err.message);
  }
}

document.getElementById('btnAddLoanType').addEventListener('click', async () => {
  const input = document.getElementById('newLoanType');
  let val = (input?.value || '').trim();
  if (!val) val = (window.prompt('Enter the new loan category name:') || '').trim();
  if (!val) return;
  if (DATA.settings.loanTypes.some(t => t.toLowerCase() === val.toLowerCase())) {
    alert('That loan category already exists.');
    return;
  }
  DATA.settings.loanTypes.push(val);
  DATA.settings.loanRules[val] = { interestRate: Number(DATA.settings.interestRate || 3), minTerm: 1, maxTerm: 6 };
  if (input) input.value = '';
  try {
    await persistSettings();
    persistLoanRules();
    renderSettings();
    openLoanRuleEditor(encodeURIComponent(val));
  } catch (err) {
    DATA.settings.loanTypes.pop();
    delete DATA.settings.loanRules[val];
    alert(err.message);
  }
});

document.getElementById('btnSaveLoanRules').addEventListener('click', async () => {
  const category = selectedLoanRuleCategory;
  const interest = Number(document.getElementById('ruleInterestRate')?.value);
  const minTerm = Number(document.getElementById('ruleMinTerm')?.value);
  const maxTerm = Number(document.getElementById('ruleMaxTerm')?.value);
  const penalty = Number(document.getElementById('setPenaltyRate')?.value) || 0;
  const grace = Number(document.getElementById('setGracePeriod')?.value) || 0;
  if (!Number.isFinite(interest) || interest < 0 || !Number.isInteger(minTerm) || minTerm < 1 || !Number.isInteger(maxTerm) || maxTerm < minTerm || penalty < 0 || grace < 0) {
    alert('Please enter valid loan rules.');
    return;
  }
  DATA.settings.loanRules[category] = { interestRate: interest, minTerm, maxTerm };
  DATA.settings.penaltyRate = penalty;
  DATA.settings.gracePeriod = grace;
  try {
    await persistSettings();
    persistLoanRules();
    renderLoanTypesList();
    alert('Loan controls saved.');
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('btnSaveCategories').addEventListener('click', async () => {
  try {
    await persistSettings();
    persistLoanRules();
    alert('Loan categories saved.');
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('setAutoBackupVisible')?.addEventListener('change', e => {
  const business = document.getElementById('setAutoBackup');
  if (business) business.checked = e.target.checked;
  DATA.settings.autoBackup = e.target.checked;
});
document.getElementById('setAutoBackup')?.addEventListener('change', e => {
  const visible = document.getElementById('setAutoBackupVisible');
  if (visible) visible.checked = e.target.checked;
  DATA.settings.autoBackup = e.target.checked;
});

document.getElementById('btnSaveSettings').addEventListener('click', async () => {
  const s = DATA.settings;
  s.companyName = document.getElementById('setCompanyName').value;
  s.tin = document.getElementById('setTIN').value;
  s.address = document.getElementById('setAddress').value;
  s.interestRate = Number(document.getElementById('setInterestRate').value) || 0;
  s.penaltyRate = Number(document.getElementById('setPenaltyRate').value) || 0;
  s.gracePeriod = Number(document.getElementById('setGracePeriod').value) || 0;
  s.autoBackup = document.getElementById('setAutoBackup').checked;
  s.cloudSync = document.getElementById('setCloudSync').checked;
  try { await persistSettings(); alert('Settings saved.'); } catch (err) { alert(err.message); }
});

document.getElementById('btnChangePassword').addEventListener('click', async () => {
  const user = firebaseAuthInstance.currentUser;
  if (!user) { alert('No active session found.'); return; }
  const current = prompt('Enter your current password:');
  if (current === null) return;
  const next = prompt('Enter your new password (min 8 characters):');
  if (!next) return;
  if (next.length < 8) { alert('Password must be at least 8 characters.'); return; }
  try {
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, current);
    await user.reauthenticateWithCredential(cred);
    await user.updatePassword(next);
    alert('Password updated successfully.');
  } catch (err) {
    alert('Could not update password: ' + friendlyFirebaseError(err));
  }
});

const SECURITY_SETTINGS_STORAGE_KEY = 'lfd-lms.security.v1';
const DEFAULT_SECURITY_SETTINGS = {
  minPasswordLength: 8, passwordExpiryDays: 90, requireUppercase: true,
  requireNumber: true, requireSpecial: false, sessionTimeoutMinutes: 15,
  maxFailedLoginAttempts: 5, twoFactorAuth: false,
  passwordChangedAt: null
};
function loadSecuritySettings(){
  try {
    const raw = localStorage.getItem(SECURITY_SETTINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_SECURITY_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch(err) { return { ...DEFAULT_SECURITY_SETTINGS }; }
}
function saveSecuritySettings(settings){
  try { localStorage.setItem(SECURITY_SETTINGS_STORAGE_KEY, JSON.stringify(settings)); }
  catch(err) { console.warn('Could not save security settings locally.', err); }
}
function securityPasswordErrors(password, settings=loadSecuritySettings()){
  const errors=[];
  if (!password || password.length < Number(settings.minPasswordLength || 8)) errors.push(`Password must be at least ${Number(settings.minPasswordLength || 8)} characters.`);
  if (settings.requireUppercase && !/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter.');
  if (settings.requireNumber && !/[0-9]/.test(password)) errors.push('Password must contain at least one number.');
  if (settings.requireSpecial && !/[^A-Za-z0-9]/.test(password)) errors.push('Password must contain at least one special character.');
  return errors;
}
function syncSecuritySettingsUI(){
  const sec = loadSecuritySettings();
  const values = {
    secMinPasswordLength: sec.minPasswordLength, secPasswordExpiry: sec.passwordExpiryDays,
    secRequireUppercase: sec.requireUppercase, secRequireNumber: sec.requireNumber, secRequireSpecial: sec.requireSpecial,
    secSessionTimeout: String(sec.sessionTimeoutMinutes), secMaxFailedAttempts: sec.maxFailedLoginAttempts,
    secTwoFactorAuth: sec.twoFactorAuth,
    setAutoBackupSecurity: !!DATA.settings?.autoBackup
  };
  Object.entries(values).forEach(([id,val])=>{ const el=document.getElementById(id); if(!el) return; if(el.type==='checkbox') el.checked=!!val; else el.value=val; });
}
function stampSecurityUpdated(id){ const el=document.getElementById(id); if(el) el.textContent=formatSettingsTimestamp(); }
function bindSecuritySettings(){
  const bind=(id,event,handler)=>{
    const el=document.getElementById(id);
    if(!el || el.dataset.boundSecurity==='1') return;
    el.dataset.boundSecurity='1';
    el.addEventListener(event,handler);
  };
  bind('btnSaveSecurityPolicy','click',()=>{
    const sec=loadSecuritySettings();
    sec.minPasswordLength=Number(document.getElementById('secMinPasswordLength')?.value)||8;
    sec.passwordExpiryDays=Math.max(0,Number(document.getElementById('secPasswordExpiry')?.value)||0);
    sec.requireUppercase=!!document.getElementById('secRequireUppercase')?.checked;
    sec.requireNumber=!!document.getElementById('secRequireNumber')?.checked;
    sec.requireSpecial=!!document.getElementById('secRequireSpecial')?.checked;
    if(sec.minPasswordLength<6 || sec.minPasswordLength>128){ alert('Minimum password length must be between 6 and 128.'); return; }
    saveSecuritySettings(sec); stampSecurityUpdated('securityPolicyUpdated');
    alert('Password policy saved.');
  });
  bind('btnSaveSecurityAccess','click',()=>{
    const sec=loadSecuritySettings();
    sec.sessionTimeoutMinutes=Math.max(0,Number(document.getElementById('secSessionTimeout')?.value)||0);
    sec.maxFailedLoginAttempts=Math.max(1,Math.min(20,Number(document.getElementById('secMaxFailedAttempts')?.value)||5));
    sec.twoFactorAuth=!!document.getElementById('secTwoFactorAuth')?.checked;
    saveSecuritySettings(sec); stampSecurityUpdated('securityAccessUpdated'); resetSessionActivityTimer();
    alert(sec.twoFactorAuth ? 'Security settings saved. Two-factor is stored as a UI setting; OTP enforcement requires an authentication-service change.' : 'Security settings saved.');
  });
  bind('setAutoBackupSecurity','change',async e=>{
    DATA.settings.autoBackup=!!e.target.checked;
    ['setAutoBackup','setAutoBackupVisible'].forEach(id=>{const el=document.getElementById(id); if(el) el.checked=DATA.settings.autoBackup;});
    try { await persistSettings(); } catch(err) { alert(err.message); }
  });
  bind('btnFactoryResetSecurity','click',()=>{
    alert('Factory reset is disabled in cloud mode to protect live Firestore records.');
  });
  bind('btnExportAllSecurity','click',()=>{
    const blob=new Blob([JSON.stringify(DATA,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='lfd_backup.json'; a.click(); URL.revokeObjectURL(url);
  });
  bind('btnImportAllSecurity','click',()=>{
    alert('Bulk import is not available in cloud mode. Records should be added or updated through the lending workflow.');
  });
  bind('btnChangeAdminPassword','click',openAdminPasswordModal);
}
function openAdminPasswordModal(){
  if(!isAdmin()){ alert('Only an administrator can change the administrator password.'); return; }
  const sec=loadSecuritySettings();
  openModal(`
    <button class="modal-close" type="button" onclick="closeModal()" aria-label="Close">×</button>
    <div class="editor-eyebrow">ADMIN PASSWORD</div>
    <h2>Change Admin Password</h2>
    <p>Use your current password to authorize the change.</p>
    <label class="field-label">CURRENT PASSWORD</label><input id="adminCurrentPassword" type="password" autocomplete="current-password">
    <label class="field-label">NEW PASSWORD</label><input id="adminNewPassword" type="password" autocomplete="new-password">
    <label class="field-label">CONFIRM NEW PASSWORD</label><input id="adminNewPassword2" type="password" autocomplete="new-password">
    <div id="adminPasswordError" class="form-modal-error"></div>
    <div class="modal-actions"><button class="btn btn-outline" type="button" onclick="closeModal()">Cancel</button><button class="btn btn-primary" type="button" id="btnSaveAdminPassword">Save Password</button></div>
  `);
  document.getElementById('btnSaveAdminPassword')?.addEventListener('click',saveAdminPassword);
}
async function saveAdminPassword(){
  const user=firebaseAuthInstance.currentUser; if(!user){ alert('No active session found.'); return; }
  const current=document.getElementById('adminCurrentPassword')?.value || '';
  const next=document.getElementById('adminNewPassword')?.value || '';
  const next2=document.getElementById('adminNewPassword2')?.value || '';
  const error=document.getElementById('adminPasswordError');
  const sec=loadSecuritySettings();
  const errors=securityPasswordErrors(next,sec);
  if(!current || !next || !next2){ error.textContent='Please complete all password fields.'; error.classList.add('show'); return; }
  if(errors.length){ error.textContent=errors.join(' '); error.classList.add('show'); return; }
  if(next!==next2){ error.textContent='New passwords do not match.'; error.classList.add('show'); return; }
  const btn=document.getElementById('btnSaveAdminPassword'); btn.disabled=true; btn.textContent='Saving...'; error.classList.remove('show');
  try {
    const cred=firebase.auth.EmailAuthProvider.credential(user.email,current);
    await user.reauthenticateWithCredential(cred); await user.updatePassword(next);
    sec.passwordChangedAt=new Date().toISOString(); saveSecuritySettings(sec); closeModal(); alert('Administrator password updated successfully.');
  } catch(err){ error.textContent='Could not update password: '+friendlyFirebaseError(err); error.classList.add('show'); btn.disabled=false; btn.textContent='Save Password'; }
}
let sessionActivityTimer=null;
let lastSessionActivity=Date.now();
function noteSessionActivity(){ lastSessionActivity=Date.now(); }
function resetSessionActivityTimer(){
  if(sessionActivityTimer) clearInterval(sessionActivityTimer);
  sessionActivityTimer=setInterval(()=>{
    if(!firebaseAuthInstance?.currentUser) return;
    const sec=loadSecuritySettings(); const mins=Number(sec.sessionTimeoutMinutes||0);
    if(mins>0 && Date.now()-lastSessionActivity >= mins*60000){
      clearInterval(sessionActivityTimer); sessionActivityTimer=null; alert('Your session has timed out due to inactivity.'); logout();
    }
  },15000);
}
['click','keydown','mousemove','touchstart','scroll'].forEach(evt=>document.addEventListener(evt,noteSessionActivity,{passive:true}));
resetSessionActivityTimer();

function runVisualAnalyticsDiagnostics() {
  const checks = [];
  const requireEl = (id) => {
    const el = document.getElementById(id);
    checks.push([id, !!el]);
    return el;
  };

  requireEl('statGrid');
  requireEl('mainChart');
  requireEl('finStatGrid');
  requireEl('finOverviewPanel');
  requireEl('finAnalyticsPanel');
  const finBody = requireEl('financialTransactionsBody');
  requireEl('finEntryCount');
  if (currentFinTab === 'overview') {
    checks.push(['financial overview stat cards', !!document.querySelectorAll('#finStatGrid .financial-stat-card').length]);
    checks.push(['financial transaction table', !!finBody?.closest('table')]);
  }
  checks.push(['dashboard SVG chart', !!document.querySelector('#mainChart svg')]);
  if (currentFinTab === 'analytics') {
    const analyticsPanel = document.getElementById('finAnalyticsPanel');
    checks.push(['data analytics shell', !!analyticsPanel?.querySelector('.analytics-shell')]);
    checks.push(['collection trend chart', !!analyticsPanel?.querySelector('.analytics-line-svg')]);
    checks.push(['loan category chart', !!analyticsPanel?.querySelector('.analytics-bar-svg')]);
    checks.push(['payment status cards', analyticsPanel?.querySelectorAll('.analytics-status-item').length === 4]);
  }

  const failed = checks.filter(([, ok]) => !ok);
  return { ok: failed.length === 0, checks, failed };
}

document.getElementById('btnVerifySystems').addEventListener('click', async () => {
  try {
    await api.get('/reports/dashboard');
    renderDashboard();
    renderFinancials();
    const diagnostics = runVisualAnalyticsDiagnostics();
    if (!diagnostics.ok) {
      console.error('Visual analytics diagnostics failed:', diagnostics.failed);
      alert('⚠ Backend connection is OK, but one or more visual analytics components failed to render.\n\nFailed: ' + diagnostics.failed.map(x => x[0]).join(', '));
      return;
    }
    alert('✔ Backend connection OK\n✔ Loan calculations OK\n✔ Dashboard analytics rendered\n✔ Financial analytics rendered\n✔ ' + DATA.loans.length + ' loans indexed\n✔ ' + DATA.clients.length + ' clients indexed');
  } catch (err) {
    alert('⚠ Could not verify backend/analytics: ' + err.message);
  }
});
document.getElementById('btnExportAll')?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'lfd_backup.json'; a.click();
  URL.revokeObjectURL(url);
});
document.getElementById('btnImportAll')?.addEventListener('click', () => {
  alert('Bulk import is not available in cloud mode. Records should be added or updated through the lending workflow.');
});
document.getElementById('btnFactoryReset')?.addEventListener('click', () => {
  alert('Factory reset is disabled in cloud mode to protect live Firestore records.');
});

/* ====================== NAV BINDINGS ====================== */
document.querySelectorAll('.nav-item, [data-view]').forEach(el => {
  el.addEventListener('click', () => showView(el.dataset.view));
});
document.getElementById('refreshBtn').addEventListener('click', async () => {
  try { await loadAllFromApi(); renderAll(); } catch (err) { alert(err.message); }
});
document.getElementById('btnLogout').addEventListener('click', logout);

/* ====================== INIT ====================== */
initAuthUI();

// Keep Firebase's LOCAL persistence so an authenticated session survives a full
// browser refresh. During the auth check we keep the application shell visible
// and do not flash the login form. Only an unauthenticated/invalid session opens
// the login screen.
showAuthChecking();

const AUTH_PERSISTENCE_READY = firebaseAuthInstance
  .setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .catch(err => {
    console.warn('Firebase persistence setup failed; continuing with the default auth behavior.', err);
  });

AUTH_PERSISTENCE_READY.finally(() => {
  firebaseAuthInstance.onAuthStateChanged(async (user) => {
    if (!user) {
      CURRENT_USER = null;
      showAuthScreen();
      return;
    }

    try {
      const profile = await api.get('/auth/me');
      await loadAllFromApi();
      enterApp(profile);
    } catch (err) {
      console.error('Session restore failed:', err);
      try { await firebaseAuthInstance.signOut(); } catch (signOutErr) { console.warn('Sign-out after restore failure failed:', signOutErr); }
      showAuthScreen();
      showAuthError('loginError', 'Your session could not be restored. Please log in again.');
    }
  });
});
