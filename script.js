// ===========================
// VARIABLES GLOBALES
// ===========================
const STORAGE_KEY = 'uploadedFileSystem';
const LEGACY_STORAGE_KEY = 'uploadedFiles';

let selectedFiles = [];
let fileSystemData = createDefaultFileSystem();
let currentFolderId = 'root';

// ===========================
// INITIALISATION
// ===========================
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    loadStoredFiles();
    updateFilesCount();
    updateCurrentFolderHints();
});

function initializeApp() {
    setupNavigation();
    setupDropZone();
    setupFilters();

    document.getElementById('browseBtn').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('fileInput').click();
    });

    document.getElementById('fileInput').addEventListener('change', handleFileSelect);
    document.getElementById('submitBtn').addEventListener('click', handleSubmit);
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);

    document.getElementById('createFolderBtn').addEventListener('click', createFolder);
    document.getElementById('uploadCurrentBtn').addEventListener('click', () => {
        document.getElementById('explorerFileInput').click();
    });
    document.getElementById('explorerFileInput').addEventListener('change', handleExplorerUpload);
}

// ===========================
// NAVIGATION
// ===========================
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const view = item.getAttribute('data-view');
            switchView(view);

            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
        });
    });
}

function switchView(view) {
    const uploadView = document.getElementById('uploadView');
    const filesView = document.getElementById('filesView');
    const pageTitle = document.getElementById('pageTitle');
    const pageSubtitle = document.getElementById('pageSubtitle');

    if (view === 'upload') {
        uploadView.classList.add('active');
        filesView.classList.remove('active');
        pageTitle.textContent = 'Déposer un fichier';
        pageSubtitle.textContent = 'Dépôt dans le dossier courant de l\'explorateur';
        updateCurrentFolderHints();
    } else if (view === 'files') {
        uploadView.classList.remove('active');
        filesView.classList.add('active');
        pageTitle.textContent = 'Explorateur de fichiers';
        pageSubtitle.textContent = 'Naviguez dans les dossiers, créez des sous-dossiers et gérez les fichiers';
        displayFiles();
    }
}

// ===========================
// DRAG & DROP
// ===========================
function setupDropZone() {
    const dropZone = document.getElementById('dropZone');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.add('drag-over');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.remove('drag-over');
        }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        handleFiles(files);
    }, false);

    dropZone.addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });
}

function handleFileSelect(e) {
    handleFiles(e.target.files);
}

function handleFiles(files) {
    if (!files || files.length === 0) return;

    selectedFiles = Array.from(files);
    displaySelectedFiles();
}

// ===========================
// AFFICHAGE DES FICHIERS SÉLECTIONNÉS
// ===========================
function displaySelectedFiles() {
    const preview = document.getElementById('uploadedFilesPreview');
    const filesList = document.getElementById('filesList');

    filesList.innerHTML = '';

    selectedFiles.forEach((file, index) => {
        const fileItem = createFileItem(file, index);
        filesList.appendChild(fileItem);
    });

    preview.style.display = 'block';
}

function createFileItem(file, index) {
    const item = document.createElement('div');
    item.className = 'file-item';

    const extension = getFileExtension(file.name);
    const fileSize = formatFileSize(file.size);
    const fileType = getFileType(extension);

    item.innerHTML = `
        <div class="file-icon" style="background: ${getFileColor(fileType)}">
            ${extension}
        </div>
        <div class="file-info-wrapper">
            <div class="file-name">${escapeHtml(file.name)}</div>
            <div class="file-meta">
                <span>${fileSize}</span>
                <span>•</span>
                <span>${fileType}</span>
            </div>
        </div>
        <button class="file-remove" onclick="removeFile(${index})">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M5 5L15 15M5 15L15 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
        </button>
    `;

    return item;
}

function removeFile(index) {
    selectedFiles.splice(index, 1);

    if (selectedFiles.length === 0) {
        document.getElementById('uploadedFilesPreview').style.display = 'none';
        document.getElementById('fileInput').value = '';
    } else {
        displaySelectedFiles();
    }
}

// ===========================
// SOUMISSION DES FICHIERS
// ===========================
function handleSubmit() {
    const name = document.getElementById('uploaderName').value.trim();
    const email = document.getElementById('uploaderEmail').value.trim();
    const comment = document.getElementById('uploaderComment').value.trim();

    if (!name) {
        alert('Veuillez entrer votre nom complet');
        document.getElementById('uploaderName').focus();
        return;
    }

    if (selectedFiles.length === 0) {
        alert('Veuillez sélectionner au moins un fichier');
        return;
    }

    addFilesToCurrentFolder(selectedFiles, { name, email, comment });

    showSuccessModal(selectedFiles.length);
    resetUploadForm();
}

function resetUploadForm() {
    document.getElementById('uploaderName').value = '';
    document.getElementById('uploaderEmail').value = '';
    document.getElementById('uploaderComment').value = '';
    document.getElementById('fileInput').value = '';
    selectedFiles = [];
    document.getElementById('uploadedFilesPreview').style.display = 'none';
}

function handleExplorerUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fallbackName = document.getElementById('uploaderName').value.trim();
    const name = prompt('Nom complet du déposant :', fallbackName || '');

    if (!name || !name.trim()) {
        alert('Upload annulé : nom du déposant requis.');
        e.target.value = '';
        return;
    }

    const email = prompt('Email (optionnel) :', document.getElementById('uploaderEmail').value.trim() || '') || '';
    const comment = prompt('Commentaire (optionnel) :', document.getElementById('uploaderComment').value.trim() || '') || '';

    addFilesToCurrentFolder(Array.from(files), {
        name: name.trim(),
        email: email.trim(),
        comment: comment.trim()
    });

    showSuccessModal(files.length);
    e.target.value = '';
    displayFiles();
}

function addFilesToCurrentFolder(files, uploader) {
    const uploadDate = new Date();
    const folder = getCurrentFolder();

    if (!folder || folder.type !== 'folder') return;

    files.forEach(file => {
        const extension = getFileExtension(file.name);
        const fileNode = {
            id: generateId(),
            type: 'file',
            name: file.name,
            extension,
            fileType: getFileType(extension),
            fileSize: file.size,
            uploaderName: uploader.name,
            uploaderEmail: uploader.email,
            comment: uploader.comment,
            uploadDate: uploadDate.toLocaleDateString('fr-FR'),
            uploadTime: uploadDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: uploadDate.getTime(),
            parentId: currentFolderId
        };

        fileSystemData.nodes[fileNode.id] = fileNode;
        folder.children.push(fileNode.id);
    });

    saveFiles();
    updateFilesCount();
}

// ===========================
// MODAL DE SUCCÈS
// ===========================
function showSuccessModal(fileCount) {
    const modal = document.getElementById('successModal');
    const message = document.getElementById('modalMessage');

    if (fileCount === 1) {
        message.textContent = 'Votre fichier a été déposé avec succès.';
    } else {
        message.textContent = `Vos ${fileCount} fichiers ont été déposés avec succès.`;
    }

    modal.classList.add('show');
}

function closeModal() {
    document.getElementById('successModal').classList.remove('show');
}

// ===========================
// EXPLORATEUR DE FICHIERS
// ===========================
function displayFiles() {
    renderBreadcrumb();
    applyFilters();
    updateCurrentFolderHints();
}

function renderBreadcrumb() {
    const breadcrumb = document.getElementById('breadcrumb');
    const path = getFolderPath(currentFolderId);

    breadcrumb.innerHTML = '';

    path.forEach((folder, index) => {
        const segment = document.createElement('button');
        segment.className = 'breadcrumb-item';
        segment.textContent = folder.name;
        segment.addEventListener('click', () => {
            currentFolderId = folder.id;
            displayFiles();
        });

        if (index === path.length - 1) {
            segment.classList.add('active');
        }

        breadcrumb.appendChild(segment);

        if (index < path.length - 1) {
            const separator = document.createElement('span');
            separator.className = 'breadcrumb-separator';
            separator.textContent = '/';
            breadcrumb.appendChild(separator);
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
    const pathText = getFolderPath(currentFolderId).map(p => p.name).join(' / ');
    document.getElementById('currentUploadFolder').textContent = `Dossier courant : ${pathText}`;
}

function createFolder() {
    const folderName = prompt('Nom du dossier :');
    if (!folderName || !folderName.trim()) return;

    const sanitizedName = folderName.trim();
    if (isNameTakenInCurrentFolder(sanitizedName)) {
        alert('Un fichier ou dossier avec ce nom existe déjà ici.');
        return;
    }

    const currentFolder = getCurrentFolder();
    const folderNode = {
        id: generateId(),
        type: 'folder',
        name: sanitizedName,
        children: [],
        createdAt: Date.now(),
        parentId: currentFolderId
    };

    fileSystemData.nodes[folderNode.id] = folderNode;
    currentFolder.children.push(folderNode.id);
    saveFiles();
    displayFiles();
}

function openFolder(folderId) {
    const folder = fileSystemData.nodes[folderId];
    if (!folder || folder.type !== 'folder') return;

    currentFolderId = folderId;
    displayFiles();
}

function renameItem(itemId) {
    const item = fileSystemData.nodes[itemId];
    if (!item) return;

    const newName = prompt('Nouveau nom :', item.name);
    if (!newName || !newName.trim()) return;

    const trimmed = newName.trim();
    if (trimmed === item.name) return;

    if (isNameTaken(trimmed, item.parentId, itemId)) {
        alert('Un élément avec ce nom existe déjà dans ce dossier.');
        return;
    }

    item.name = trimmed;
    if (item.type === 'file') {
        item.extension = getFileExtension(trimmed);
        item.fileType = getFileType(item.extension);
    }

    saveFiles();
    displayFiles();
}

function deleteItem(itemId) {
    const item = fileSystemData.nodes[itemId];
    if (!item) return;

    const label = item.type === 'folder' ? 'ce dossier et tout son contenu' : 'ce fichier';
    if (!confirm(`Êtes-vous sûr de vouloir supprimer ${label} ?`)) {
        return;
    }

    removeNodeRecursively(itemId);
    saveFiles();
    displayFiles();
    updateFilesCount();
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

    const details = `
Nom du fichier: ${file.name}
Type: ${file.fileType}
Taille: ${formatFileSize(file.fileSize)}
Déposé par: ${file.uploaderName}
Email: ${file.uploaderEmail || 'Non renseigné'}
Date: ${file.uploadDate} à ${file.uploadTime}
Commentaire: ${file.comment || 'Aucun commentaire'}
    `;

    alert(details);
}

function createItemRow(item) {
    const row = document.createElement('tr');
    const isFolder = item.type === 'folder';

    const nameCell = isFolder
        ? `<button class="folder-link" onclick="openFolder('${item.id}')">📁 ${escapeHtml(item.name)}</button>`
        : `<div class="file-name-cell"><div class="file-icon" style="background: ${getFileColor(item.fileType)}; width: 32px; height: 32px; font-size: 0.65rem;">${item.extension}</div>${escapeHtml(item.name)}</div>`;

    const typeLabel = isFolder ? 'Dossier' : item.fileType;
    const typeClass = isFolder ? 'folder' : item.fileType.toLowerCase();
    const sizeText = isFolder ? '-' : formatFileSize(item.fileSize);
    const userText = isFolder ? '-' : escapeHtml(item.uploaderName);
    const dateText = isFolder
        ? new Date(item.createdAt).toLocaleDateString('fr-FR')
        : `${item.uploadDate} ${item.uploadTime}`;

    row.innerHTML = `
        <td>${nameCell}</td>
        <td><span class="file-type-badge ${typeClass}">${typeLabel}</span></td>
        <td>${sizeText}</td>
        <td>${userText}</td>
        <td>${dateText}</td>
        <td class="actions-cell">
            ${isFolder ? `<button class="action-btn" onclick="openFolder('${item.id}')" title="Ouvrir">Ouvrir</button>` : `<button class="action-btn" onclick="viewFileDetails('${item.id}')" title="Voir">Détails</button>`}
            <button class="action-btn" onclick="renameItem('${item.id}')" title="Renommer">Renommer</button>
            <button class="action-btn delete" onclick="deleteItem('${item.id}')" title="Supprimer">Supprimer</button>
        </td>
    `;

    return row;
}

// ===========================
// FILTRES ET RECHERCHE
// ===========================
function setupFilters() {
    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('filterType').addEventListener('change', applyFilters);
    document.getElementById('filterSort').addEventListener('change', applyFilters);
}

function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const typeFilter = document.getElementById('filterType').value;
    const sortFilter = document.getElementById('filterSort').value;

    const currentFolder = getCurrentFolder();
    if (!currentFolder || !Array.isArray(currentFolder.children)) return;

    let items = currentFolder.children
        .map(id => fileSystemData.nodes[id])
        .filter(Boolean);

    if (searchTerm) {
        items = items.filter(item => {
            const uploader = item.type === 'file' ? item.uploaderName || '' : '';
            return item.name.toLowerCase().includes(searchTerm) || uploader.toLowerCase().includes(searchTerm);
        });
    }

    if (typeFilter !== 'all') {
        items = items.filter(item => {
            if (typeFilter === 'folder') return item.type === 'folder';
            if (item.type !== 'file') return false;

            const type = item.fileType.toLowerCase();
            if (typeFilter === 'pdf') return type === 'pdf';
            if (typeFilter === 'doc') return type === 'doc';
            if (typeFilter === 'image') return type === 'image';
            if (typeFilter === 'video') return type === 'video';
            if (typeFilter === 'other') return ['other', 'archive', 'spreadsheet', 'presentation'].includes(type);
            return true;
        });
    }

    items.sort((a, b) => {
        if (sortFilter === 'recent') {
            const aTime = a.type === 'folder' ? a.createdAt : a.timestamp;
            const bTime = b.type === 'folder' ? b.createdAt : b.timestamp;
            return bTime - aTime;
        }
        if (sortFilter === 'oldest') {
            const aTime = a.type === 'folder' ? a.createdAt : a.timestamp;
            const bTime = b.type === 'folder' ? b.createdAt : b.timestamp;
            return aTime - bTime;
        }
        if (sortFilter === 'name') {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return a.name.localeCompare(b.name);
        }
        if (sortFilter === 'size') {
            if (a.type === 'folder' && b.type === 'folder') return 0;
            if (a.type === 'folder') return -1;
            if (b.type === 'folder') return 1;
            return b.fileSize - a.fileSize;
        }
        return 0;
    });

    const tbody = document.getElementById('filesTableBody');
    const emptyState = document.getElementById('emptyState');

    tbody.innerHTML = '';

    if (items.length === 0) {
        emptyState.classList.add('show');
        return;
    }

    emptyState.classList.remove('show');
    items.forEach(item => tbody.appendChild(createItemRow(item)));
}

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

// ===========================
// UTILITAIRES
// ===========================
function getFileExtension(filename) {
    const parts = filename.split('.');
    if (parts.length < 2) return 'FILE';
    return parts.pop().toUpperCase();
}

function getFileType(extension) {
    const ext = extension.toLowerCase();

    if (ext === 'pdf') return 'PDF';
    if (['doc', 'docx', 'txt', 'odt'].includes(ext)) return 'DOC';
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) return 'Image';
    if (['mp4', 'avi', 'mov', 'wmv', 'mkv'].includes(ext)) return 'Video';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'Archive';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'Spreadsheet';
    if (['ppt', 'pptx'].includes(ext)) return 'Presentation';

    return 'Other';
}

function getFileColor(fileType) {
    const colors = {
        'PDF': '#DC2626',
        'DOC': '#2563EB',
        'Image': '#059669',
        'Video': '#7C3AED',
        'Archive': '#F59E0B',
        'Spreadsheet': '#10B981',
        'Presentation': '#EC4899',
        'Other': '#64748B'
    };

    return colors[fileType] || colors.Other;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
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
            if (parsed && parsed.nodes && parsed.nodes.root) {
                fileSystemData = parsed;
                if (!fileSystemData.nodes[currentFolderId]) {
                    currentFolderId = fileSystemData.rootId || 'root';
                }
                return;
            }
        } catch (error) {
            console.error('Impossible de lire le stockage explorateur :', error);
        }
    }

    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
        try {
            const legacyFiles = JSON.parse(legacy);
            migrateLegacyData(legacyFiles);
            saveFiles();
        } catch (error) {
            console.error('Impossible de migrer les anciennes données :', error);
        }
    }
}

function migrateLegacyData(legacyFiles) {
    fileSystemData = createDefaultFileSystem();

    if (!Array.isArray(legacyFiles)) return;

    legacyFiles.forEach(file => {
        const fileId = file.id || generateId();
        const extension = file.extension || getFileExtension(file.fileName || 'fichier');

        fileSystemData.nodes[fileId] = {
            id: fileId,
            type: 'file',
            name: file.fileName || `fichier-${fileId}`,
            extension,
            fileType: file.fileType || getFileType(extension),
            fileSize: file.fileSize || 0,
            uploaderName: file.uploaderName || 'Inconnu',
            uploaderEmail: file.uploaderEmail || '',
            comment: file.comment || '',
            uploadDate: file.uploadDate || new Date().toLocaleDateString('fr-FR'),
            uploadTime: file.uploadTime || new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: file.timestamp || Date.now(),
            parentId: 'root'
        };

        fileSystemData.nodes.root.children.push(fileId);
    });
}

function updateFilesCount() {
    const total = Object.values(fileSystemData.nodes).filter(node => node.type === 'file').length;
    document.getElementById('totalFiles').textContent = total;
}

// ===========================
// EXPORT (pour actions inline)
// ===========================
window.removeFile = removeFile;
window.openFolder = openFolder;
window.renameItem = renameItem;
window.deleteItem = deleteItem;
window.viewFileDetails = viewFileDetails;
