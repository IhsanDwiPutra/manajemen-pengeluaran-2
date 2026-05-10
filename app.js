// Mengimpor modul Firebase lengkap (ditambah updateDoc untuk update qty stok)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAXjaGDcqGOS0zxHObEc4kJN120p62lm4U",
  authDomain: "spent-app-e1141.firebaseapp.com",
  projectId: "spent-app-e1141",
  storageBucket: "spent-app-e1141.firebasestorage.app",
  messagingSenderId: "113195094216",
  appId: "1:113195094216:web:c735f7eae578efa6b395fd"
  };
const appId = 'spent-pwa-local';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// State Keuangan
let allData = [];
let pieChart = null;
let currentMonthFilter = 'all';

// State Stok Barang
let allInventory = [];

let currentUser = null;
let isDataLoaded = false;
let unsubscribeSnapshot = null;
let unsubscribeInventory = null;

const geminiApiKey = ""; // Kosongkan agar bisa diisi via form

document.getElementById('tanggalInput').valueAsDate = new Date();

// ── Kategori Config ──
const katConfig = {
  pengeluaran: {
    makanan:       { label: 'Makanan',      cls: 'badge-makanan',      icon: '🍜', color: '#fbbf24' },
    transportasi:  { label: 'Transportasi', cls: 'badge-transportasi', icon: '🚌', color: '#60a5fa' },
    hiburan:       { label: 'Hiburan',      cls: 'badge-hiburan',      icon: '🎮', color: '#a78bfa' },
    kesehatan:     { label: 'Kesehatan',    cls: 'badge-kesehatan',    icon: '💊', color: '#34d399' },
    belanja:       { label: 'Belanja',      cls: 'badge-belanja',      icon: '🛍️', color: '#f87171' },
    lainnya:       { label: 'Lainnya',      cls: 'badge-lainnya',      icon: '📦', color: '#9ca3af' },
  },
  pemasukan: {
    gaji:          { label: 'Gaji Bulanan', cls: 'badge-kesehatan',    icon: '💰', color: '#34d399' },
    bonus:         { label: 'Bonus / THR',  cls: 'badge-transportasi', icon: '🎁', color: '#60a5fa' },
    investasi:     { label: 'Investasi',    cls: 'badge-hiburan',      icon: '📈', color: '#a78bfa' },
    lainnya:       { label: 'Lainnya',      cls: 'badge-lainnya',      icon: '📦', color: '#9ca3af' }
  }
};

window.updateKategoriOptions = function() {
  const tipe = document.getElementById('tipeInput').value;
  const select = document.getElementById('kategoriInput');
  select.innerHTML = '<option value="">— Pilih kategori —</option>';
  const kats = katConfig[tipe];
  for (const key in kats) select.innerHTML += `<option value="${key}">${kats[key].icon} ${kats[key].label}</option>`;
  
  document.getElementById('splitBillContainer').style.display = (tipe === 'pengeluaran') ? 'flex' : 'none';
  if(tipe === 'pemasukan') {
      document.getElementById('isSplitBill').checked = false;
      window.toggleSplitBill();
  }
};
window.updateKategoriOptions();

const fmtCurrency = n => { const sign = n < 0 ? '-' : ''; return sign + 'Rp ' + Math.abs(Math.round(n)).toLocaleString('id-ID'); };
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

window.formatRupiahInput = function(inputElement) {
  let val = inputElement.value.replace(/\D/g, '');
  document.getElementById('nominalInputVal').value = val;
  inputElement.value = val !== '' ? parseInt(val, 10).toLocaleString('id-ID') : '';
  window.calculateSplit();
};

window.toggleSplitBill = function() {
  const isSplit = document.getElementById('isSplitBill').checked;
  const details = document.getElementById('splitDetails');
  if (isSplit) {
    details.classList.add('show'); window.calculateSplit();
  } else {
    details.classList.remove('show');
  }
};

window.calculateSplit = function() {
  if (!document.getElementById('isSplitBill').checked) return;
  const total = parseFloat(document.getElementById('nominalInputVal').value) || 0;
  const count = parseInt(document.getElementById('splitCount').value) || 2;
  const portion = total / count;
  document.getElementById('splitTotalDisplay').textContent = fmtCurrency(total);
  document.getElementById('splitPortionDisplay').textContent = fmtCurrency(portion);
};

// ── Integrasi AI ──
window.promptApiKey = function() {
  const currentKey = localStorage.getItem('gemini_api_key') || '';
  const key = prompt("PENGATURAN AI:\nMasukkan API Key dari Google AI Studio.", currentKey);
  if (key !== null) { localStorage.setItem('gemini_api_key', key.trim()); if (key.trim()) alert("API Key berhasil disimpan!"); }
};

window.handleReceiptScan = async function(event) {
  const file = event.target.files[0]; if (!file) return; event.target.value = '';
  const savedKey = geminiApiKey || localStorage.getItem('gemini_api_key');
  if (!savedKey) return alert("API Key belum diatur!\nKlik ikon gembok 🔓.");

  const aiModal = document.getElementById('aiModal'); aiModal.classList.add('show');
  try {
    const base64Data = await resizeAndConvertImage(file);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${savedKey}`;
    
    const payload = {
      contents: [{ role: "user", parts: [
          { text: "Anda adalah asisten keuangan. Analisis foto struk ini. Ekstrak: 1. Nama toko. 2. Total harga akhir belanja. 3. Tebak kategorinya (HANYA pilih dari: makanan, transportasi, hiburan, kesehatan, belanja, lainnya). Kembalikan format JSON: {\"nama\": \"Indomaret\", \"nominal\": 56000, \"kategori\": \"belanja\"} tanpa markdown." },
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
      ]}],
      generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { nama: { type: "STRING" }, nominal: { type: "NUMBER" }, kategori: { type: "STRING" } } } }
    };

    let resultJSON = null, delays = [1000, 2000, 4000];
    for (let i = 0; i <= delays.length; i++) {
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) { if(response.status === 400) throw new Error("API Key tidak valid."); throw new Error(`HTTP ${response.status}`); }
        const textResult = (await response.json()).candidates?.[0]?.content?.parts?.[0]?.text;
        if(!textResult) throw new Error("AI tidak mengenali struk.");
        resultJSON = JSON.parse(textResult); break; 
      } catch (err) { if (i === delays.length) throw err; await new Promise(r => setTimeout(r, delays[i])); }
    }

    if (resultJSON) {
      document.getElementById('tipeInput').value = 'pengeluaran'; window.updateKategoriOptions();
      document.getElementById('namaInput').value = resultJSON.nama || 'Struk Terbaca';
      const nominal = parseInt(resultJSON.nominal) || 0;
      document.getElementById('nominalInputVal').value = nominal;
      document.getElementById('nominalInputDisplay').value = nominal > 0 ? nominal.toLocaleString('id-ID') : '';
      const katRaw = (resultJSON.kategori || '').toLowerCase(), validKats = Object.keys(katConfig.pengeluaran);
      document.getElementById('kategoriInput').value = validKats.includes(katRaw) ? katRaw : 'lainnya';
      window.calculateSplit();
      showToast('toastAi');
    }
  } catch (error) { alert("Gagal: " + error.message); } finally { aiModal.classList.remove('show'); }
};

function resizeAndConvertImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas'); const MAX_SIZE = 1000; let width = img.width, height = img.height;
        if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } } else { if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } }
        canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]); 
      }; img.src = e.target.result;
    }; reader.onerror = reject; reader.readAsDataURL(file);
  });
}

// ── Google Auth ──
window.loginGoogle = async function() {
  const btnLogin = document.getElementById('btnLogin'); btnLogin.disabled = true; btnLogin.innerHTML = 'Memuat...';
  try { await signInWithPopup(auth, googleProvider); showToast('toastLogin'); } 
  catch (error) { showModal({ icon: '❌', title: 'Login Gagal', body: 'Terjadi kesalahan.', btnConfirmText: 'Tutup', btnConfirmClass: 'btn-confirm-danger' }); } 
  finally { btnLogin.disabled = false; btnLogin.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Masuk dengan Google'; }
};
window.logoutGoogle = async function() { showModal({ icon: '👋', title: 'Keluar Akun?', body: 'Anda akan keluar dari sesi ini. Data Anda aman tersimpan di Cloud.', btnCancelText: 'Batal', btnConfirmText: 'Ya, Keluar', btnConfirmClass: 'btn-confirm-danger', onConfirm: async () => { try { await signOut(auth); } catch(e) {} } }); };

onAuthStateChanged(auth, (user) => {
  currentUser = user; const loginScreen = document.getElementById('loginScreen'), mainApp = document.getElementById('mainApp'), userProfile = document.getElementById('userProfile');
  if (user) {
    loginScreen.style.display = 'none'; mainApp.style.display = 'flex'; userProfile.style.display = 'flex';
    document.getElementById('userName').textContent = user.displayName ? user.displayName.split(' ')[0] : 'Pengguna';
    document.getElementById('userAvatar').src = user.photoURL || './icon-192.png';
    setupRealtimeListener();
  } else {
    loginScreen.style.display = 'flex'; mainApp.style.display = 'none'; userProfile.style.display = 'none';
    allData = []; allInventory = []; isDataLoaded = false;
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    if (unsubscribeInventory) unsubscribeInventory();
    if (pieChart) { pieChart.destroy(); pieChart = null; }
  }
});

function setupRealtimeListener() {
  if (!currentUser) return;
  
  // Listener 1: Keuangan (Expenses)
  const colRef = collection(db, 'artifacts', appId, 'users', currentUser.uid, 'expenses');
  if (unsubscribeSnapshot) unsubscribeSnapshot();
  unsubscribeSnapshot = onSnapshot(colRef, (snapshot) => { isDataLoaded = true; allData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); refreshUI(); }, (error) => { console.error(error); showToast('toastErr'); });

  // Listener 2: Stok Pribadi (Inventory)
  const invRef = collection(db, 'artifacts', appId, 'users', currentUser.uid, 'inventory');
  if (unsubscribeInventory) unsubscribeInventory();
  unsubscribeInventory = onSnapshot(invRef, (snapshot) => {
    allInventory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderInventory();
  });
}

// ── Rendering UI Keuangan ──
window.applyMonthFilter = function() { currentMonthFilter = document.getElementById('monthFilter').value; refreshUI(); }
function getFilteredData() { return currentMonthFilter === 'all' ? allData : allData.filter(d => d.tgl.startsWith(currentMonthFilter)); }

function updateMonthDropdown() {
  const select = document.getElementById('monthFilter'), months = new Set();
  allData.forEach(d => months.add(d.tgl.substring(0, 7))); 
  const sortedMonths = Array.from(months).sort().reverse();
  const currentVal = select.value;
  let optionsHTML = `<option value="all">Semua Waktu</option>`;
  sortedMonths.forEach(m => { const [year, month] = m.split('-'); optionsHTML += `<option value="${m}">${new Date(year, month - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</option>`; });
  select.innerHTML = optionsHTML; const todayYYYYMM = new Date().toISOString().substring(0, 7);
  if (currentVal !== 'all' && sortedMonths.includes(currentVal)) select.value = currentVal;
  else if (sortedMonths.includes(todayYYYYMM)) { select.value = todayYYYYMM; currentMonthFilter = todayYYYYMM; }
  else select.value = 'all';
}

function refreshUI() {
  if (!isDataLoaded) return; 
  updateMonthDropdown(); const dataToRender = getFilteredData(); renderTable(dataToRender); updateStats(dataToRender); updateChart(dataToRender);
}

function updateStats(data) {
  let totalMasuk = 0, totalKeluar = 0, maxIn = 0, maxOut = 0;
  data.forEach(d => {
    const t = d.tipe || 'pengeluaran';
    if (t === 'pemasukan') { totalMasuk += d.nominal; if (d.nominal > maxIn) maxIn = d.nominal; } 
    else { totalKeluar += d.nominal; if (d.nominal > maxOut) maxOut = d.nominal; }
  });
  document.getElementById('totalAmount').textContent = fmtCurrency(totalMasuk - totalKeluar);
  document.getElementById('totMasuk').textContent    = fmtCurrency(totalMasuk);
  document.getElementById('totKeluar').textContent   = fmtCurrency(totalKeluar);
  document.getElementById('txCount').textContent = data.length;
  document.getElementById('maxIn').textContent   = fmtCurrency(maxIn);
  document.getElementById('maxOut').textContent  = fmtCurrency(maxOut);
  document.getElementById('countBadge').textContent = data.length + ' entri';
  document.getElementById('totalLabel').textContent = currentMonthFilter === 'all' ? 'Sisa Saldo Anda (Semua)' : 'Sisa Saldo Bulan Ini';
}

function renderTable(data) {
  const tbody = document.getElementById('tableBody');
  if (data.length === 0) { tbody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="icon">🧾</div><p>Belum ada transaksi tersimpan.</p></div></td></tr>`; return; }
  const sortedData = [...data].sort((a,b) => new Date(b.tgl) - new Date(a.tgl) || (b.createdAt || 0) - (a.createdAt || 0));
  tbody.innerHTML = sortedData.map((d) => {
    const t = d.tipe || 'pengeluaran', k = katConfig[t][d.kat] || katConfig[t].lainnya;
    const cls = t === 'pemasukan' ? 'masuk' : 'keluar', prefix = t === 'pemasukan' ? '+ ' : '- ';
    const splitNama = d.splitNotes ? ` <small>${d.splitNotes}</small>` : '';
    return `<tr>
        <td class="td-name">${escHtml(d.nama)} ${splitNama}</td>
        <td><span class="badge ${k.cls}">${k.icon} ${k.label}</span></td>
        <td class="td-date">${new Date(d.tgl + 'T00:00:00').toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' })}</td>
        <td class="td-amount ${cls}" style="text-align:right">${prefix}${fmtCurrency(d.nominal)}</td>
        <td style="text-align:center"><button class="btn-del-red" onclick="konfirmasiHapus('${d.id}', '${escHtml(d.nama).replace(/'/g,"\\'")}')">🗑</button></td>
      </tr>`;
  }).join('');
}

function updateChart(data) {
  const chartBody = document.getElementById('chartBody'), expData = data.filter(d => (d.tipe || 'pengeluaran') === 'pengeluaran');
  const grouped = {}; expData.forEach(d => { grouped[d.kat] = (grouped[d.kat] || 0) + d.nominal; });
  const keys = Object.keys(grouped), total = expData.reduce((s, d) => s + d.nominal, 0);

  if (keys.length === 0) {
    if (pieChart) { pieChart.destroy(); pieChart = null; }
    chartBody.innerHTML = `<div class="chart-empty"><div class="icon">📊</div><p>Belum ada data pengeluaran untuk grafik.</p></div>`; return;
  }

  const labels = keys.map(k => (katConfig.pengeluaran[k] || katConfig.pengeluaran.lainnya).icon + ' ' + (katConfig.pengeluaran[k] || katConfig.pengeluaran.lainnya).label);
  const values = keys.map(k => grouped[k]), colors = keys.map(k => (katConfig.pengeluaran[k] || katConfig.pengeluaran.lainnya).color);

  const legendHTML = keys.map(k => {
    const cfg = katConfig.pengeluaran[k] || katConfig.pengeluaran.lainnya;
    return `<div class="legend-item"><span class="legend-dot" style="background:${cfg.color}"></span><span class="legend-name">${cfg.icon} ${cfg.label}</span><span class="legend-pct">${total > 0 ? ((grouped[k] / total) * 100).toFixed(1) : '0.0'}%</span><span class="legend-val">${fmtCurrency(grouped[k])}</span></div>`;
  }).join('');

  if (!pieChart || !document.getElementById('pieCanvas')) {
    chartBody.innerHTML = `<div class="chart-canvas-wrap"><canvas id="pieCanvas"></canvas><div class="chart-center-label"><span class="cl-count" id="clCount">${expData.length}</span><span class="cl-sub">pengeluaran</span></div></div><div class="chart-legend" id="chartLegend">${legendHTML}</div>`;
    pieChart = new Chart(document.getElementById('pieCanvas').getContext('2d'), { type: 'doughnut', data: { labels, datasets: [{ data: values, backgroundColor: colors.map(c => c + 'cc'), borderColor: colors.map(c => c + 'bb'), borderWidth: 2, hoverOffset: 8 }] }, options: { responsive: true, cutout: '68%', animation: { animateRotate: true, duration: 600 }, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1c1c26', borderColor: '#2a2a38', borderWidth: 1, titleColor: '#e8e8f0', bodyColor: '#9ca3af', padding: 12, callbacks: { label: ctx => `  ${fmtCurrency(ctx.parsed)}  (${total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0'}%)` } } } } });
  } else {
    pieChart.data.labels = labels; pieChart.data.datasets[0].data = values; pieChart.data.datasets[0].backgroundColor = colors.map(c => c + 'cc'); pieChart.data.datasets[0].borderColor = colors.map(c => c + 'bb');
    pieChart.update(); document.getElementById('chartLegend').innerHTML = legendHTML; document.getElementById('clCount').textContent = expData.length;
  }
}

// ── CRUD Firebase (Keuangan) ──
window.tambahTransaksi = async function() {
  const tipe = document.getElementById('tipeInput').value, nama = document.getElementById('namaInput').value.trim(), nominalAsli = parseFloat(document.getElementById('nominalInputVal').value), kat = document.getElementById('kategoriInput').value, tgl = document.getElementById('tanggalInput').value, isSplit = document.getElementById('isSplitBill').checked;
  const shake = id => { const el = document.getElementById(id); el.style.borderColor = 'var(--danger)'; el.style.boxShadow = '0 0 0 3px rgba(248,113,113,.25)'; el.focus(); setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 1800); };
  if (!nama) return shake('namaInput'); if (!nominalAsli || nominalAsli <= 0) return shake('nominalInputDisplay'); if (!kat) return shake('kategoriInput'); if (!tgl) return shake('tanggalInput');
  if (!currentUser) return showToast('toastErr');

  let finalNominal = nominalAsli, splitNotes = "";
  if (isSplit && tipe === 'pengeluaran') {
    const splitCount = parseInt(document.getElementById('splitCount').value) || 2;
    if (splitCount > 1) { finalNominal = nominalAsli / splitCount; splitNotes = `Patungan 1/${splitCount} dari ${fmtCurrency(nominalAsli)}`; }
  }

  const btn = document.getElementById('btnAdd'); btn.disabled = true; btn.textContent = 'Menyimpan...';
  try {
    await addDoc(collection(db, 'artifacts', appId, 'users', currentUser.uid, 'expenses'), { tipe, nama, nominal: finalNominal, kat, tgl, splitNotes, createdAt: Date.now() });
    currentMonthFilter = tgl.substring(0,7); showToast('toastAdd');
    document.getElementById('namaInput').value = ''; document.getElementById('nominalInputDisplay').value = ''; document.getElementById('nominalInputVal').value = ''; document.getElementById('kategoriInput').value = '';
    if(isSplit) { document.getElementById('isSplitBill').checked = false; window.toggleSplitBill(); }
  } catch (err) { showToast('toastErr'); } finally { btn.disabled = false; btn.textContent = 'Simpan Transaksi'; }
};

window.konfirmasiHapus = function(id, nama) { showModal({ icon: '⚠️', title: 'Hapus Transaksi?', body: `Hapus <strong>"${nama}"</strong> dari riwayat?`, btnConfirmText: 'Hapus Data', btnConfirmClass: 'btn-confirm-danger', onConfirm: async () => { try { await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, 'expenses', id)); showToast('toastDel'); } catch(e) { showToast('toastErr'); } } }); };


// ── CRUD Firebase (STOK PRIBADI / INVENTORY) ──
function renderInventory() {
  const grid = document.getElementById('stokGrid');
  if (!grid) return;
  
  if (allInventory.length === 0) {
    grid.innerHTML = `<div class="empty" style="grid-column: 1 / -1;"><div class="icon">📦</div><p>Belum ada stok barang. Tambahkan di form atas!</p></div>`;
    return;
  }

  const sorted = [...allInventory].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  grid.innerHTML = sorted.map(item => {
    let statusCls = 'aman';
    if (item.jumlah === 0) statusCls = 'habis';
    else if (item.jumlah <= 3) statusCls = 'tipis';

    return `
      <div class="stok-card ${statusCls}">
        <div class="stok-header">
          <span class="stok-title">${escHtml(item.nama)}</span>
          <button class="btn-del-icon" title="Hapus" onclick="hapusStok('${item.id}', '${escHtml(item.nama).replace(/'/g,"\\'")}')">🗑</button>
        </div>
        <div class="stok-body">
          <button class="stok-btn minus" onclick="updateStok('${item.id}', ${item.jumlah}, -1)">-</button>
          <div class="stok-qty">${item.jumlah} <small>${escHtml(item.satuan)}</small></div>
          <button class="stok-btn plus" onclick="updateStok('${item.id}', ${item.jumlah}, 1)">+</button>
        </div>
      </div>
    `;
  }).join('');
}

window.tambahStok = async function() {
  const nama = document.getElementById('stokNama').value.trim();
  const jumlah = parseInt(document.getElementById('stokJumlah').value) || 0;
  const satuan = document.getElementById('stokSatuan').value.trim() || 'pcs';

  if (!nama) {
    const el = document.getElementById('stokNama');
    el.style.borderColor = 'var(--danger)';
    setTimeout(() => el.style.borderColor = '', 1800);
    return;
  }

  if (!currentUser) return showToast('toastErr');

  const btn = document.getElementById('btnTambahStok');
  btn.disabled = true; btn.textContent = 'Menyimpan...';

  try {
    await addDoc(collection(db, 'artifacts', appId, 'users', currentUser.uid, 'inventory'), {
      nama, jumlah, satuan, createdAt: Date.now()
    });
    document.getElementById('stokNama').value = '';
    document.getElementById('stokJumlah').value = '';
    document.getElementById('stokSatuan').value = '';
    showToast('toastAdd');
  } catch(e) {
    console.error(e);
    showToast('toastErr');
  } finally {
    btn.disabled = false; btn.textContent = 'Simpan Barang';
  }
};

window.updateStok = async function(id, currentJumlah, delta) {
  const newJumlah = currentJumlah + delta;
  if (newJumlah < 0) return; // Mencegah stok minus

  if (!currentUser) return;

  try {
    await updateDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, 'inventory', id), {
      jumlah: newJumlah
    });
  } catch (e) {
    console.error(e); showToast('toastErr');
  }
};

window.hapusStok = function(id, nama) {
  showModal({
    icon: '⚠️', title: 'Hapus Barang?',
    body: `Yakin ingin menghapus <strong>"${nama}"</strong> dari daftar stok?`,
    btnConfirmText: 'Hapus', btnConfirmClass: 'btn-confirm-danger',
    onConfirm: async () => {
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, 'inventory', id));
        showToast('toastDel');
      } catch(e) { showToast('toastErr'); }
    }
  });
};


// ── Ekspor & Impor (Keuangan) ──
window.eksporCSV = function() {
  if (allData.length === 0) return showModal({ icon: 'ℹ️', title: 'Data Kosong', body: 'Tidak ada data.', btnConfirmText: 'Tutup', btnConfirmClass: 'btn-confirm-ok' });
  const esc = v => { const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = allData.map(d => [ esc(d.tipe || 'pengeluaran'), esc(d.nama + (d.splitNotes ? ` (${d.splitNotes})` : '')), esc((katConfig[d.tipe||'pengeluaran'][d.kat] || katConfig[d.tipe||'pengeluaran'].lainnya).label), esc(d.tgl), esc(d.nominal) ].join(','));
  const blob = new Blob(['\uFEFF' + ['Tipe,Nama,Kategori,Tanggal,Nominal'].concat(rows).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pembukuan_cloud_${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a); showToast('toastExport');
};

window.triggerImport = function() {
  if (allData.length > 0) showModal({ icon: '⚠️', title: 'Timpa Data Cloud?', body: `Anda memiliki <strong>${allData.length} entri</strong>. Mengimpor file akan <strong>MENGHAPUS</strong> semua data saat ini.`, btnCancelText: 'Batal', btnConfirmText: 'Ya, Timpa Data', btnConfirmClass: 'btn-confirm-warn', onConfirm: () => document.getElementById('csvFileInput').click() });
  else document.getElementById('csvFileInput').click();
};

window.prosesImportCSV = function(event) {
  const file = event.target.files[0]; if (!file) return; event.target.value = '';
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const lines = e.target.result.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim() !== ''); if (lines.length < 2) throw new Error('File kosong/tanpa data.');
      const header = lines[0].split(',').map(h => h.trim().toLowerCase());
      const iTipe = header.indexOf('tipe'), iNama = header.indexOf('nama'), iKat = header.indexOf('kategori'), iTgl = header.indexOf('tanggal'), iNom = header.indexOf('nominal');
      if(iNama < 0 || iTgl < 0 || iNom < 0) throw new Error("Kolom Nama, Tanggal, atau Nominal tidak ditemukan.");
      const labelToKey = { pengeluaran: {}, pemasukan: {} };
      Object.entries(katConfig.pengeluaran).forEach(([k, v]) => labelToKey.pengeluaran[v.label.toLowerCase()] = k); Object.entries(katConfig.pemasukan).forEach(([k, v]) => labelToKey.pemasukan[v.label.toLowerCase()] = k);

      function parseCSV(line) { const res = []; let cur = '', inQ = false; for (let i=0; i<line.length; i++) { const ch = line[i]; if (ch === '"') { if (inQ && line[i+1]==='"') { cur+='"'; i++; } else inQ = !inQ; } else if (ch === ',' && !inQ) { res.push(cur.trim()); cur = ''; } else cur += ch; } res.push(cur.trim()); return res; }
      
      const imported = [], errors = [];
      lines.slice(1).forEach((line, idx) => {
        const cols = parseCSV(line), nom = parseFloat(cols[iNom]), tipe = (iTipe >= 0 && cols[iTipe]) ? cols[iTipe].toLowerCase().trim() : 'pengeluaran', validTipe = (tipe === 'pemasukan' || tipe === 'pengeluaran') ? tipe : 'pengeluaran';
        if (!cols[iNama]) return errors.push(`Baris ${idx+2}: Nama kosong`); if (isNaN(nom)||nom<=0) return errors.push(`Baris ${idx+2}: Nominal salah`); if (!/^\d{4}-\d{2}-\d{2}$/.test(cols[iTgl])) return errors.push(`Baris ${idx+2}: Format tgl salah`);
        imported.push({ tipe: validTipe, nama: cols[iNama], kat: labelToKey[validTipe][(cols[iKat]||'').toLowerCase().trim()] || 'lainnya', tgl: cols[iTgl], nominal: nom, createdAt: Date.now() + idx });
      });

      if (imported.length === 0) throw new Error('Tidak ada baris valid.'); if (!currentUser) throw new Error('Anda belum terkoneksi ke Cloud.');
      document.getElementById('btnImport').disabled = true; document.getElementById('btnImport').textContent = 'Mengunggah...';

      await Promise.all(allData.map(d => deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, 'expenses', d.id))));
      const colRef = collection(db, 'artifacts', appId, 'users', currentUser.uid, 'expenses');
      await Promise.all(imported.map(d => addDoc(colRef, d)));

      currentMonthFilter = 'all'; showToast('toastImport');
      if (errors.length > 0) showModal({ icon: '⚠️', title: 'Impor Selesai dengan Peringatan', body: `Beberapa baris dilewati:\n${errors.slice(0,3).join('\n')}`, btnConfirmText: 'Mengerti', btnConfirmClass: 'btn-confirm-warn' });
    } catch (err) { showModal({ icon: '❌', title: 'Gagal Impor', body: err.message, btnConfirmText: 'Tutup', btnConfirmClass: 'btn-confirm-danger' }); } 
    finally { document.getElementById('btnImport').disabled = false; document.getElementById('btnImport').innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Impor Data (CSV)`; }
  }; reader.readAsText(file, 'UTF-8');
};

function showModal({ icon, title, body, btnCancelText, btnConfirmText, btnConfirmClass, onConfirm }) {
  const modalOverlay = document.getElementById('appModal'); document.getElementById('modalIcon').textContent = icon; document.getElementById('modalTitle').textContent = title; document.getElementById('modalBody').innerHTML = body;
  const actions = document.getElementById('modalActions'); actions.innerHTML = '';
  if (btnCancelText) { const btnC = document.createElement('button'); btnC.className = 'modal-btn btn-cancel'; btnC.textContent = btnCancelText; btnC.onclick = () => modalOverlay.classList.remove('show'); actions.appendChild(btnC); }
  if (btnConfirmText) { const btnY = document.createElement('button'); btnY.className = `modal-btn ${btnConfirmClass}`; btnY.textContent = btnConfirmText; btnY.onclick = () => { modalOverlay.classList.remove('show'); if(onConfirm) onConfirm(); }; actions.appendChild(btnY); }
  modalOverlay.classList.add('show');
}

function showToast(id) { const t = document.getElementById(id); t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); }
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') window.tambahTransaksi(); });

// Registrasi Service Worker PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {});
}