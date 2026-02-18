const AUTH_STORAGE_KEY = 'filedesk_current_user';
const AUTH_CACHE_KEY = 'filedesk_current_user_cache';
const API_BASE_URL = (window.AppConfig && window.AppConfig.apiBaseUrl) || 'http://localhost:3000';

document.addEventListener('DOMContentLoaded', () => {
    const savedId = localStorage.getItem(AUTH_STORAGE_KEY);
    if (savedId) {
        window.location.href = 'index.html';
        return;
    }

    const form = document.getElementById('loginForm');
    const errorEl = document.getElementById('loginError');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.classList.remove('show');

        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if (!username || !password) {
            errorEl.textContent = 'Veuillez remplir tous les champs.';
            errorEl.classList.add('show');
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const payload = await response.json();
            if (!response.ok || !payload.ok || !payload.user) {
                throw new Error(payload.message || 'Login incorrect');
            }

            localStorage.setItem(AUTH_STORAGE_KEY, String(payload.user.id));
            localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(payload.user));
            window.location.href = 'index.html';
        } catch (error) {
            errorEl.textContent = 'Identifiants incorrects ou serveur indisponible.';
            errorEl.classList.add('show');
        }
    });
});
