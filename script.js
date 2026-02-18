// ===========================
// VARIABLES GLOBALES
// ===========================
const STORAGE_KEY = 'filedesk_v2';
const LEGACY_STORAGE_KEY = 'uploadedFiles';
const AUTH_STORAGE_KEY = 'fleursville_current_user';
const AUTH_CACHE_KEY = 'filedesk_current_user_cache';
const API_BASE_URL = (window.AppConfig && window.AppConfig.apiBaseUrl) || 'http://localhost:3000';

let selectedFiles = [];
let fileSystemData = createDefaultFileSystem();
let currentFolderId = 'root';
let expandedUploadFolderIds = new Set(['root']);
let currentAuthUser = null;

// ===========================
// INITIALISATION
// ===========================
document.addEventListener('DOMContentLoaded', async () => {
    const isAuthenticated = await initAuth();
    if (!isAuthenticated) {
        return;
    }

    loadStoredFiles();
    initNavigation();
    initDropZone();
    initFilters();
    initMobileMenu();
    initModals();
    initUploadFolderPicker();
    updateFilesCount();
    populateUploadFolderSelect(currentFolderId);
    updateCurrentFolderHints();

    document.getElementById('browseBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', handleFileSelect);
    document.getElementById('submitBtn').addEventListener('click', handleSubmit);
    document.getElementById('clearFilesBtn').addEventListener('click', clearAllFiles);

    document.getElementById('createFolderBtn').addEventListener('click', openFolderModal);
    document.getElementById('uploadCurrentBtn').addEventListener('click', () => {
        document.getElementById('explorerFileInput').click();
    });
    document.getElementById('explorerFileInput').addEventListener('change', handleExplorerUpload);
});

// ===========================
// NAVIGATION
// ===========================
function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            switchView(view);
            // Close mobile sidebar
            closeMobileSidebar();
        });
    });
}

function switchView(view) {
    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    if (view === 'upload') {
        document.getElementById('uploadView').classList.add('active');
        updateCurrentFolderHints();
    } else if (view === 'files') {
        document.getElementById('filesView').classList.add('active');
        displayFiles();
    }
}

// ===========================
// MOBILE MENU
// ===========================
function initMobileMenu() {
    const btn = document.getElementById('hamburgerBtn');
    const overlay = document.getElementById('sidebarOverlay');
    if (!btn) return;

    btn.addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        const isOpen = sidebar.classList.contains('open');
        if (isOpen) closeMobileSidebar();
        else openMobileSidebar();
    });

    overlay.addEventListener('click', closeMobileSidebar);
}

function openMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const btn = document.getElementById('hamburgerBtn');
    sidebar.classList.add('open');
    overlay.classList.add('visible');
    btn.classList.add('open');
}

function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const btn = document.getElementById('hamburgerBtn');
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
    btn.classList.remove('open');
}

// ===========================
// AUTHENTIFICATION
// ===========================
async function initAuth() {
    const savedId = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!savedId) {
        redirectToLogin();
        return false;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(savedId)}`);
        if (!response.ok) throw new Error('Unauthorized');
        const user = await response.json();
        currentAuthUser = user;
        localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(user));
        hydrateUserUI(user);
        bindLogout();
        return true;
    } catch (error) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(AUTH_CACHE_KEY);
        redirectToLogin();
        return false;
    }
}

function hydrateUserUI(user) {
    const name = (user && user.name && user.name.trim()) || user.username || 'Utilisateur';
    const initials = name
        .split(' ')
        .filter(Boolean)
        .map(word => word[0].toUpperCase())
        .slice(0, 2)
        .join('') || 'U';

    const roleMap = {
        admin: 'Administrateur',
        alternant: 'Alternant',
        salarie: 'Salarié'
    };

    const initialsEl = document.getElementById('userInitials');
    const nameEl = document.getElementById('userName');
    const roleEl = document.getElementById('userRole');

    if (initialsEl) initialsEl.textContent = initials;
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = roleMap[user.role] || user.role || 'Utilisateur';
}

function bindLogout() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (!logoutBtn) return;
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(AUTH_CACHE_KEY);
        redirectToLogin();
    });
}

function redirectToLogin() {
    window.location.href = 'login.html';
}

// ===========================
// MODALS
// ===========================
function initModals() {
    document.getElementById('modalCloseBtn').addEventListener('click', closeSuccessModal);
    document.getElementById('modalBackdrop').addEventListener('click', closeSuccessModal);

    document.getElementById('folderCancelBtn').addEventListener('click', closeFolderModal);
    document.getElementById('folderModalBackdrop').addEventListener('click', closeFolderModal);
    document.getElementById('folderConfirmBtn').addEventListener('click', confirmCreateFolder);
    document.getElementById('itemInfoCloseBtn').addEventListener('click', closeItemInfoModal);
    document.getElementById('itemInfoModalBackdrop').addEventListener('click', closeItemInfoModal);
    document.getElementById('folderNameInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmCreateFolder();
        if (e.key === 'Escape') closeFolderModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSuccessModal();
            closeFolderModal();
            closeItemInfoModal();
        }
    });
}

function initUploadFolderPicker() {
    const picker = document.getElementById('uploadFolderPicker');
    const button = document.getElementById('uploadFolderPickerBtn');
    const menu = document.getElementById('uploadFolderPickerMenu');
    if (!picker || !button || !menu) return;

    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isOpen = picker.classList.contains('open');
        picker.classList.toggle('open', !isOpen);
        button.setAttribute('aria-expanded', String(!isOpen));
    });

    document.addEventListener('click', (e) => {
        if (!picker.contains(e.target)) {
            picker.classList.remove('open');
            button.setAttribute('aria-expanded', 'false');
        }
    });
}

function showSuccessModal(fileCount) {
    const modal = document.getElementById('successModal');
    const msg = document.getElementById('modalMessage');
    msg.textContent = fileCount === 1
        ? 'Votre fichier a été déposé avec succès.'
        : `Vos ${fileCount} fichiers ont été déposés avec succès.`;
    modal.style.display = 'flex';
}

function closeSuccessModal() {
    document.getElementById('successModal').style.display = 'none';
}

function openFolderModal() {
    const modal = document.getElementById('folderModal');
    const input = document.getElementById('folderNameInput');
    input.value = '';
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 60);
}

function closeFolderModal() {
    document.getElementById('folderModal').style.display = 'none';
}

function showItemInfoModal(itemId) {
    const item = fileSystemData.nodes[itemId];
    if (!item) return;

    const titleEl = document.getElementById('itemInfoTitle');
    const bodyEl = document.getElementById('itemInfoBody');
    const modal = document.getElementById('itemInfoModal');
    if (!titleEl || !bodyEl || !modal) return;

    const lines = item.type === 'folder'
        ? [
            ['Type', 'Dossier'],
            ['Nom', item.name],
            ['Date', new Date(item.createdAt).toLocaleDateString('fr-FR')]
        ]
        : [
            ['Type', item.fileType],
            ['Nom', item.name],
            ['Taille', formatFileSize(item.fileSize)],
            ['Déposé par', item.uploaderName || '—'],
            ['Date', `${item.uploadDate} ${item.uploadTime || ''}`.trim()],
            ['Commentaire', item.comment || '—']
        ];

    titleEl.textContent = `Infos ${item.type === 'folder' ? 'dossier' : 'fichier'}`;
    bodyEl.innerHTML = lines.map(([label, value]) => (
        `<div class="item-info-row"><span class="item-info-label">${escapeHtml(label)}</span><span class="item-info-value">${escapeHtml(value)}</span></div>`
    )).join('');
    modal.style.display = 'flex';
}

function closeItemInfoModal() {
    const modal = document.getElementById('itemInfoModal');
    if (modal) modal.style.display = 'none';
}

function confirmCreateFolder() {
    const input = document.getElementById('folderNameInput');
    const name = input.value.trim();

    if (!name) {
        input.focus();
        showToast('Entrez un nom de dossier', 'error');
        return;
    }

    if (isNameTakenInCurrentFolder(name)) {
        showToast('Un élément avec ce nom existe déjà', 'error');
        input.select();
        return;
    }

    const currentFolder = getCurrentFolder();
    const folderNode = {
        id: generateId(),
        type: 'folder',
        name,
        children: [],
        createdAt: Date.now(),
        parentId: currentFolderId
    };

    fileSystemData.nodes[folderNode.id] = folderNode;
    currentFolder.children.push(folderNode.id);
    saveFiles();
    displayFiles();
    closeFolderModal();
    showToast(`Dossier « ${name} » créé`, 'success');
}

// ===========================
// DRAG & DROP
// ===========================
function initDropZone() {
    const dropZone = document.getElementById('dropZone');
    const idle = document.getElementById('dropIdle');
    const active = document.getElementById('dropActive');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
        document.body.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); });
    });

    dropZone.addEventListener('dragenter', () => {
        dropZone.classList.add('drag-over');
        idle.style.display = 'none';
        active.style.display = 'flex';
    });

    dropZone.addEventListener('dragleave', (e) => {
        if (!dropZone.contains(e.relatedTarget)) {
            dropZone.classList.remove('drag-over');
            idle.style.display = 'flex';
            active.style.display = 'none';
        }
    });

    dropZone.addEventListener('drop', (e) => {
        dropZone.classList.remove('drag-over');
        idle.style.display = 'flex';
        active.style.display = 'none';
        handleFiles(e.dataTransfer.files);
    });

    dropZone.addEventListener('click', (e) => {
        if (e.target.closest('#browseBtn')) return;
        document.getElementById('fileInput').click();
    });

    dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            document.getElementById('fileInput').click();
        }
    });
}

function handleFileSelect(e) {
    handleFiles(e.target.files);
}

function handleFiles(files) {
    if (!files || files.length === 0) return;
    const newFiles = Array.from(files).filter(f => f.size <= 50 * 1024 * 1024);
    const oversized = Array.from(files).filter(f => f.size > 50 * 1024 * 1024);

    if (oversized.length > 0) {
        showToast(`${oversized.length} fichier(s) ignoré(s) — dépasse 50 MB`, 'error');
    }

    if (newFiles.length === 0) return;

    // Merge and deduplicate by name
    newFiles.forEach(f => {
        if (!selectedFiles.find(sf => sf.name === f.name && sf.size === f.size)) {
            selectedFiles.push(f);
        }
    });

    renderSelectedFiles();
}

// ===========================
// AFFICHAGE DES FICHIERS SÉLECTIONNÉS
// ===========================
function renderSelectedFiles() {
    const preview = document.getElementById('uploadedFilesPreview');
    const list = document.getElementById('filesList');
    const label = document.getElementById('fileCountLabel');

    const n = selectedFiles.length;
    label.textContent = `${n} fichier${n > 1 ? 's' : ''} sélectionné${n > 1 ? 's' : ''}`;

    list.innerHTML = '';
    selectedFiles.forEach((file, i) => {
        const li = document.createElement('li');
        li.className = 'file-item';
        const ext = getFileExtension(file.name);
        const type = getFileType(ext);
        const color = getFileColor(type);

        li.innerHTML = `
            <div class="file-ext" style="background:${color}">${ext.slice(0,4)}</div>
            <div class="file-item-info">
                <div class="file-item-name">${escapeHtml(file.name)}</div>
                <div class="file-item-meta">${formatFileSize(file.size)} · ${type}</div>
            </div>
            <button class="file-remove" onclick="removeFile(${i})" aria-label="Retirer ${escapeHtml(file.name)}">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                    <path d="M5 5L15 15M5 15L15 5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
                </svg>
            </button>
        `;
        list.appendChild(li);
    });

    preview.style.display = n > 0 ? 'block' : 'none';
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderSelectedFiles();
    if (selectedFiles.length === 0) {
        document.getElementById('fileInput').value = '';
    }
}

function clearAllFiles() {
    selectedFiles = [];
    document.getElementById('fileInput').value = '';
    document.getElementById('uploadedFilesPreview').style.display = 'none';
}

// ===========================
// SOUMISSION
// ===========================
function handleSubmit() {
    if (selectedFiles.length === 0) {
        showToast('Sélectionnez au moins un fichier', 'error');
        return;
    }

    if (!currentAuthUser) {
        showToast('Session invalide, reconnectez-vous.', 'error');
        redirectToLogin();
        return;
    }

    const name = (currentAuthUser.name || currentAuthUser.username || 'Utilisateur').trim();
    const email = (currentAuthUser.email || '').trim();
    const comment = document.getElementById('uploaderComment').value.trim();
    const targetFolderId = document.getElementById('uploadTargetFolder').value || currentFolderId;

    addFilesToFolder(selectedFiles, { name, email, comment }, targetFolderId);
    showSuccessModal(selectedFiles.length);
    resetUploadForm();
}

function resetUploadForm() {
    document.getElementById('uploaderComment').value = '';
    document.getElementById('fileInput').value = '';
    selectedFiles = [];
    document.getElementById('uploadedFilesPreview').style.display = 'none';
}

function handleExplorerUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!currentAuthUser) {
        showToast('Session invalide, reconnectez-vous.', 'error');
        e.target.value = '';
        redirectToLogin();
        return;
    }

    const name = (currentAuthUser.name || currentAuthUser.username || '').trim();
    if (!name) {
        showToast('Profil utilisateur invalide.', 'error');
        e.target.value = '';
        return;
    }

    const email = (currentAuthUser.email || '').trim();
    const comment = document.getElementById('uploaderComment').value.trim();

    addFilesToFolder(Array.from(files), { name, email, comment }, currentFolderId);
    showToast(`${files.length} fichier(s) uploadé(s)`, 'success');
    e.target.value = '';
    displayFiles();
}

function addFilesToCurrentFolder(files, uploader) {
    addFilesToFolder(files, uploader, currentFolderId);
}

function addFilesToFolder(files, uploader, folderId) {
    const folder = fileSystemData.nodes[folderId];
    if (!folder || folder.type !== 'folder') return;

    const now = new Date();
    files.forEach(file => {
        const ext = getFileExtension(file.name);
        const node = {
            id: generateId(),
            type: 'file',
            name: file.name,
            extension: ext,
            fileType: getFileType(ext),
            fileSize: file.size,
            uploaderName: uploader.name,
            uploaderEmail: uploader.email || '',
            comment: uploader.comment || '',
            uploadDate: now.toLocaleDateString('fr-FR'),
            uploadTime: now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: now.getTime(),
            parentId: folderId
        };
        fileSystemData.nodes[node.id] = node;
        folder.children.push(node.id);
    });

    saveFiles();
    updateFilesCount();
}

// ===========================
// EXPLORATEUR
// ===========================
function displayFiles() {
    populateUploadFolderSelect();
    renderBreadcrumb();
    applyFilters();
    updateCurrentFolderHints();
}

function renderBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    const path = getFolderPath(currentFolderId);
    bc.innerHTML = '';

    path.forEach((folder, i) => {
        const btn = document.createElement('button');
        btn.className = 'breadcrumb-item' + (i === path.length - 1 ? ' active' : '');
        btn.textContent = folder.name;
        btn.addEventListener('click', () => {
            if (i < path.length - 1) {
                currentFolderId = folder.id;
                displayFiles();
            }
        });
        bc.appendChild(btn);

        if (i < path.length - 1) {
            const sep = document.createElement('span');
            sep.className = 'breadcrumb-separator';
            sep.textContent = '/';
            bc.appendChild(sep);
        }
    });
}

function getFolderPath(folderId) {
    const path = [];
    let cursor = fileSystemData.nodes[folderId];
    while (cursor) {
        path.unshift({ id: cursor.id, name: cursor.name });
        if (!cursor.parentId) break;
        cursor = fileSystemData.nodes[cursor.parentId];
    }
    return path;
}

function updateCurrentFolderHints() {
    const selectedFolderId = document.getElementById('uploadTargetFolder')?.value || currentFolderId;
    const path = getFolderPath(selectedFolderId);
    const pathText = (path.length ? path : getFolderPath(fileSystemData.rootId || 'root'))
        .map(p => p.name)
        .join(' / ');
    const el = document.getElementById('currentUploadFolder');
    if (el) el.innerHTML = `Dossier cible : <strong>${pathText}</strong>`;
}

function openFolder(folderId) {
    const folder = fileSystemData.nodes[folderId];
    if (!folder || folder.type !== 'folder') return;
    currentFolderId = folderId;
    displayFiles();
    updateCurrentFolderHints();
}

function renameItem(itemId) {
    const item = fileSystemData.nodes[itemId];
    if (!item) return;

    const newName = prompt('Nouveau nom :', item.name);
    if (!newName || !newName.trim() || newName.trim() === item.name) return;

    const trimmed = newName.trim();
    if (isNameTaken(trimmed, item.parentId, itemId)) {
        showToast('Un élément avec ce nom existe déjà', 'error');
        return;
    }

    item.name = trimmed;
    if (item.type === 'file') {
        item.extension = getFileExtension(trimmed);
        item.fileType = getFileType(item.extension);
    }

    saveFiles();
    displayFiles();
    showToast('Renommé avec succès', 'success');
}

function deleteItem(itemId) {
    const item = fileSystemData.nodes[itemId];
    if (!item) return;

    const label = item.type === 'folder' ? 'ce dossier et tout son contenu' : 'ce fichier';
    if (!confirm(`Supprimer ${label} ?`)) return;

    removeNodeRecursively(itemId);
    saveFiles();
    displayFiles();
    updateFilesCount();
    showToast('Élément supprimé', 'info');
}

function removeNodeRecursively(itemId) {
    const item = fileSystemData.nodes[itemId];
    if (!item) return;

    if (item.type === 'folder') {
        [...item.children].forEach(childId => removeNodeRecursively(childId));
    }

    const parent = fileSystemData.nodes[item.parentId];
    if (parent && Array.isArray(parent.children)) {
        parent.children = parent.children.filter(id => id !== itemId);
    }

    delete fileSystemData.nodes[itemId];

    if (currentFolderId === itemId) {
        currentFolderId = parent ? parent.id : 'root';
    }
}

function viewFileDetails(fileId) {
    const file = fileSystemData.nodes[fileId];
    if (!file || file.type !== 'file') return;

    alert(
        `📄 ${file.name}\n\n` +
        `Type : ${file.fileType}\n` +
        `Taille : ${formatFileSize(file.fileSize)}\n` +
        `Déposé par : ${file.uploaderName}\n` +
        (file.uploaderEmail ? `Email : ${file.uploaderEmail}\n` : '') +
        `Date : ${file.uploadDate} à ${file.uploadTime}\n` +
        (file.comment ? `\nCommentaire :\n${file.comment}` : '')
    );
}

function createItemRow(item) {
    const tr = document.createElement('tr');
    const isFolder = item.type === 'folder';
    if (isFolder) tr.classList.add('folder-row');

    const ext = isFolder ? '' : item.extension || '?';
    const color = isFolder ? '' : getFileColor(item.fileType);
    const badgeClass = getBadgeClass(item);
    const badgeLabel = isFolder ? 'Dossier' : item.fileType;

    const nameCell = isFolder
        ? `<button class="folder-btn" onclick="openFolder('${item.id}')">
               <span class="folder-btn-icon">📁</span>
               ${escapeHtml(item.name)}
               <span class="folder-chip">Dossier</span>
           </button>`
        : `<div class="file-name-cell">
               <div class="file-icon-sm" style="background:${color}">${escapeHtml(ext.slice(0,4))}</div>
               ${escapeHtml(item.name)}
           </div>`;

    const size = isFolder ? '—' : formatFileSize(item.fileSize);
    const user = isFolder ? '—' : escapeHtml(item.uploaderName);
    const date = isFolder
        ? new Date(item.createdAt).toLocaleDateString('fr-FR')
        : `${item.uploadDate}`;

    tr.innerHTML = `
        <td data-label="Nom" class="cell-name">${nameCell}</td>
        <td data-label="Type"><span class="badge ${badgeClass}">${badgeLabel}</span></td>
        <td data-label="Taille" class="cell-muted">${size}</td>
        <td data-label="Déposé par">${user}</td>
        <td data-label="Date" class="cell-muted">${date}</td>
        <td data-label="Actions" class="actions-cell">
            <button class="action-btn mobile-info-btn" onclick="showItemInfoModal('${item.id}')">Infos</button>
            ${isFolder
                ? `<button class="action-btn" onclick="openFolder('${item.id}')">Ouvrir</button>`
                : `<button class="action-btn" onclick="viewFileDetails('${item.id}')">Détails</button>`
            }
            <button class="action-btn" onclick="renameItem('${item.id}')">Renommer</button>
            <button class="action-btn delete" onclick="deleteItem('${item.id}')">Supprimer</button>
        </td>
    `;
    return tr;
}

function getBadgeClass(item) {
    if (item.type === 'folder') return 'badge-folder';
    const t = (item.fileType || '').toLowerCase();
    const map = {
        'pdf': 'badge-pdf',
        'doc': 'badge-doc',
        'image': 'badge-image',
        'video': 'badge-video',
        'archive': 'badge-archive',
        'spreadsheet': 'badge-spreadsheet',
        'presentation': 'badge-presentation'
    };
    return map[t] || 'badge-other';
}

// ===========================
// FILTRES
// ===========================
function initFilters() {
    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('filterType').addEventListener('change', applyFilters);
    document.getElementById('filterSort').addEventListener('change', applyFilters);
}

function applyFilters() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const type = document.getElementById('filterType').value;
    const sort = document.getElementById('filterSort').value;

    const folder = getCurrentFolder();
    if (!folder || !Array.isArray(folder.children)) return;

    let items = folder.children.map(id => fileSystemData.nodes[id]).filter(Boolean);

    if (search) {
        items = items.filter(item => {
            const uploaderName = item.type === 'file' ? item.uploaderName || '' : '';
            return item.name.toLowerCase().includes(search) || uploaderName.toLowerCase().includes(search);
        });
    }

    if (type !== 'all') {
        items = items.filter(item => {
            if (type === 'folder') return item.type === 'folder';
            if (item.type !== 'file') return false;
            const t = item.fileType.toLowerCase();
            if (type === 'pdf') return t === 'pdf';
            if (type === 'doc') return t === 'doc';
            if (type === 'image') return t === 'image';
            if (type === 'video') return t === 'video';
            if (type === 'other') return ['other', 'archive', 'spreadsheet', 'presentation'].includes(t);
            return true;
        });
    }

    items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;

        if (sort === 'name') {
            return a.name.localeCompare(b.name, 'fr');
        }
        const tA = a.type === 'folder' ? a.createdAt : a.timestamp;
        const tB = b.type === 'folder' ? b.createdAt : b.timestamp;
        if (sort === 'recent') return tB - tA;
        if (sort === 'oldest') return tA - tB;
        if (sort === 'size') {
            if (a.type === 'folder') return -1;
            if (b.type === 'folder') return 1;
            return b.fileSize - a.fileSize;
        }
        return 0;
    });

    const tbody = document.getElementById('filesTableBody');
    const empty = document.getElementById('emptyState');

    tbody.innerHTML = '';

    if (items.length === 0) {
        empty.classList.add('show');
    } else {
        empty.classList.remove('show');
        items.forEach(item => tbody.appendChild(createItemRow(item)));
    }
}

function populateUploadFolderSelect(preferredFolderId = null) {
    const hiddenInput = document.getElementById('uploadTargetFolder');
    const label = document.getElementById('uploadFolderPickerLabel');
    const tree = document.getElementById('uploadFolderTree');
    if (!hiddenInput || !label || !tree) return;

    const rootId = fileSystemData.rootId || 'root';
    const currentValue = preferredFolderId || hiddenInput.value || currentFolderId || rootId;
    const selectedFolder = fileSystemData.nodes[currentValue]?.type === 'folder' ? currentValue : rootId;

    hiddenInput.value = selectedFolder;
    ensureUploadTreePathExpanded(selectedFolder);

    const path = getFolderPath(selectedFolder).map(folder => folder.name).join(' / ');
    label.textContent = path || 'Racine';

    tree.innerHTML = '';
    renderUploadFolderTreeNode(rootId, 0, selectedFolder, tree);
}

function renderUploadFolderTreeNode(folderId, level, selectedFolderId, container) {
    const folder = fileSystemData.nodes[folderId];
    if (!folder || folder.type !== 'folder') return;

    const children = getFolderChildrenSorted(folderId);
    const hasChildren = children.length > 0;
    const isExpanded = expandedUploadFolderIds.has(folderId);
    const isSelected = folderId === selectedFolderId;

    const row = document.createElement('div');
    row.className = `folder-tree-row${isSelected ? ' selected' : ''}`;
    row.style.setProperty('--level', String(level));

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `folder-tree-toggle${hasChildren ? '' : ' empty'}${isExpanded ? ' expanded' : ''}`;
    toggle.setAttribute('aria-label', hasChildren ? 'Déplier/Replier le dossier' : 'Aucun sous-dossier');
    toggle.innerHTML = hasChildren ? '▶' : '';
    toggle.disabled = !hasChildren;
    toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!hasChildren) return;
        if (expandedUploadFolderIds.has(folderId)) {
            expandedUploadFolderIds.delete(folderId);
        } else {
            expandedUploadFolderIds.add(folderId);
        }
        populateUploadFolderSelect(selectedFolderId);
    });

    const itemButton = document.createElement('button');
    itemButton.type = 'button';
    itemButton.className = 'folder-tree-item';
    itemButton.innerHTML = `<span class="folder-tree-icon">📁</span><span class="folder-tree-name">${escapeHtml(folder.name)}</span>`;
    itemButton.addEventListener('click', () => {
        const hiddenInput = document.getElementById('uploadTargetFolder');
        const picker = document.getElementById('uploadFolderPicker');
        const pickerButton = document.getElementById('uploadFolderPickerBtn');
        if (!hiddenInput) return;
        hiddenInput.value = folderId;
        ensureUploadTreePathExpanded(folderId);
        populateUploadFolderSelect(folderId);
        updateCurrentFolderHints();
        if (picker && pickerButton) {
            picker.classList.remove('open');
            pickerButton.setAttribute('aria-expanded', 'false');
        }
    });

    row.appendChild(toggle);
    row.appendChild(itemButton);
    container.appendChild(row);

    if (!hasChildren || !isExpanded) return;

    children.forEach(child => {
        renderUploadFolderTreeNode(child.id, level + 1, selectedFolderId, container);
    });
}

function getFolderChildrenSorted(folderId) {
    const folder = fileSystemData.nodes[folderId];
    if (!folder || folder.type !== 'folder') return [];

    return (folder.children || [])
        .map(id => fileSystemData.nodes[id])
        .filter(node => node && node.type === 'folder')
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

function ensureUploadTreePathExpanded(folderId) {
    const path = getFolderPath(folderId);
    path.forEach(folder => expandedUploadFolderIds.add(folder.id));
}

// ===========================
// TOAST NOTIFICATIONS
// ===========================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-dot"></span>${escapeHtml(message)}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('out');
        setTimeout(() => toast.remove(), 280);
    }, 3200);
}

// ===========================
// UTILITAIRES
// ===========================
function getCurrentFolder() {
    return fileSystemData.nodes[currentFolderId];
}

function isNameTakenInCurrentFolder(name) {
    return isNameTaken(name, currentFolderId);
}

function isNameTaken(name, parentId, excludedId = null) {
    const parent = fileSystemData.nodes[parentId];
    if (!parent || !Array.isArray(parent.children)) return false;
    return parent.children.some(childId => {
        if (excludedId && childId === excludedId) return false;
        const child = fileSystemData.nodes[childId];
        return child && child.name.toLowerCase() === name.toLowerCase();
    });
}

function getFileExtension(filename) {
    const parts = filename.split('.');
    return parts.length < 2 ? 'FILE' : parts.pop().toUpperCase();
}

function getFileType(extension) {
    const ext = extension.toLowerCase();
    if (ext === 'pdf') return 'PDF';
    if (['doc', 'docx', 'txt', 'odt', 'rtf'].includes(ext)) return 'DOC';
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'avif', 'bmp'].includes(ext)) return 'Image';
    if (['mp4', 'avi', 'mov', 'wmv', 'mkv', 'webm'].includes(ext)) return 'Video';
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return 'Archive';
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'Spreadsheet';
    if (['ppt', 'pptx', 'odp'].includes(ext)) return 'Presentation';
    return 'Other';
}

function getFileColor(fileType) {
    const map = {
        'PDF':          '#DC2626',
        'DOC':          '#2563EB',
        'Image':        '#059669',
        'Video':        '#7C3AED',
        'Archive':      '#0D9488',
        'Spreadsheet':  '#16A34A',
        'Presentation': '#DB2777',
        'Other':        '#6B7A99'
    };
    return map[fileType] || map.Other;
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0) + ' ' + sizes[i];
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ===========================
// STOCKAGE LOCAL
// ===========================
function createDefaultFileSystem() {
    return {
        rootId: 'root',
        nodes: {
            root: {
                id: 'root',
                type: 'folder',
                name: 'Racine',
                children: [],
                createdAt: Date.now(),
                parentId: null
            }
        }
    };
}

function saveFiles() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fileSystemData));
}

function loadStoredFiles() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (parsed?.nodes?.root) {
                fileSystemData = parsed;
                if (!fileSystemData.nodes[currentFolderId]) {
                    currentFolderId = fileSystemData.rootId || 'root';
                }
                return;
            }
        } catch (err) {
            console.error('Erreur lecture stockage :', err);
        }
    }

    // Migration ancien format
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
        try {
            migrateLegacyData(JSON.parse(legacy));
            saveFiles();
        } catch (err) {
            console.error('Erreur migration :', err);
        }
    }
}

function migrateLegacyData(legacyFiles) {
    fileSystemData = createDefaultFileSystem();
    if (!Array.isArray(legacyFiles)) return;

    legacyFiles.forEach(file => {
        const fileId = file.id || generateId();
        const ext = file.extension || getFileExtension(file.fileName || 'fichier');
        fileSystemData.nodes[fileId] = {
            id: fileId,
            type: 'file',
            name: file.fileName || `fichier-${fileId}`,
            extension: ext,
            fileType: file.fileType || getFileType(ext),
            fileSize: file.fileSize || 0,
            uploaderName: file.uploaderName || 'Inconnu',
            uploaderEmail: file.uploaderEmail || '',
            comment: file.comment || '',
            uploadDate: file.uploadDate || new Date().toLocaleDateString('fr-FR'),
            uploadTime: file.uploadTime || '00:00',
            timestamp: file.timestamp || Date.now(),
            parentId: 'root'
        };
        fileSystemData.nodes.root.children.push(fileId);
    });
}

function updateFilesCount() {
    return Object.values(fileSystemData.nodes).filter(n => n.type === 'file').length;
}

// ===========================
// EXPOSE GLOBAUX (inline handlers)
// ===========================
window.removeFile = removeFile;
window.openFolder = openFolder;
window.renameItem = renameItem;
window.deleteItem = deleteItem;
window.viewFileDetails = viewFileDetails;
window.showItemInfoModal = showItemInfoModal;
