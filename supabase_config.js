(function() {
    // Supabase client configuration and Auth utility module
    const DEFAULT_SUPABASE_URL = "https://gcrpigehmbjnvkiklzwi.supabase.co";
    const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjcnBpZ2VobWJqbnZraWtsendpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyOTUzMTUsImV4cCI6MjA1ODg3MTMxNX0.sb_publishable_LVg3YKs_mGVtIKTKU3jEsQ_QE57f7gL";

    function getActiveUrl() {
        return localStorage.getItem('wtb_supabase_url') || DEFAULT_SUPABASE_URL;
    }

    function getActiveAnonKey() {
        return localStorage.getItem('wtb_supabase_anon_key') || DEFAULT_SUPABASE_ANON_KEY;
    }

    function createClientInstance(url, key) {
        if (window.supabase && typeof window.supabase.createClient === 'function') {
            try {
                return window.supabase.createClient(url, key);
            } catch (e) {
                console.warn("[AuthManager] Client init failed:", e);
                return null;
            }
        }
        return null;
    }

    // Initialize Supabase Client
    window.supabaseClient = createClientInstance(getActiveUrl(), getActiveAnonKey());

    class AuthManager {
        static isInitialized() {
            return !!window.supabaseClient;
        }

        static getProjectUrl() {
            return getActiveUrl();
        }

        static getAnonKey() {
            return getActiveAnonKey();
        }

        static getDefaultUrl() {
            return DEFAULT_SUPABASE_URL;
        }

        static getDefaultAnonKey() {
            return DEFAULT_SUPABASE_ANON_KEY;
        }

        static setCustomCredentials(url, anonKey) {
            const cleanUrl = (url || '').trim().replace(/\/+$/, '');
            const cleanKey = (anonKey || '').trim();
            if (cleanUrl) {
                localStorage.setItem('wtb_supabase_url', cleanUrl);
            } else {
                localStorage.removeItem('wtb_supabase_url');
            }
            if (cleanKey) {
                localStorage.setItem('wtb_supabase_anon_key', cleanKey);
            } else {
                localStorage.removeItem('wtb_supabase_anon_key');
            }
            window.supabaseClient = createClientInstance(getActiveUrl(), getActiveAnonKey());
        }

        static resetToDefaults() {
            localStorage.removeItem('wtb_supabase_url');
            localStorage.removeItem('wtb_supabase_anon_key');
            window.supabaseClient = createClientInstance(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY);
        }

        static async checkHealth() {
            const url = getActiveUrl();
            if (!url) return { ok: false, error: 'No Supabase URL configured' };
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000);
                const res = await fetch(`${url}/auth/v1/health`, {
                    method: 'GET',
                    mode: 'cors',
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                return { ok: res.ok || res.status === 200 || res.status === 404, status: res.status };
            } catch (err) {
                return { ok: false, error: err.message || 'DNS/Network Unreachable' };
            }
        }

        static async getSession() {
            if (!this.isInitialized()) return null;
            try {
                const { data: { session }, error } = await window.supabaseClient.auth.getSession();
                if (error) console.warn("Session fetch failed:", error);
                return session;
            } catch (e) {
                console.warn("Session fetch exception:", e);
                return null;
            }
        }

        static async getUser() {
            const session = await this.getSession();
            return session ? session.user : null;
        }

        static async isLoggedIn() {
            const session = await this.getSession();
            return !!session;
        }

        // Email/Password Sign Up
        static async signUp(email, password) {
            if (!this.isInitialized()) return { error: { message: "Auth client not ready" } };
            try {
                const { data, error } = await window.supabaseClient.auth.signUp({ email, password });
                return { data, error };
            } catch (e) {
                return { error: e };
            }
        }

        // Email/Password Sign In
        static async signIn(email, password) {
            if (!this.isInitialized()) return { error: { message: "Auth client not ready" } };
            try {
                const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
                return { data, error };
            } catch (e) {
                return { error: e };
            }
        }

        // Social login (OAuth) helper - handles redirect flows
        static async signInWithOAuth(provider) {
            if (!this.isInitialized()) return { error: { message: "Auth client not ready" } };
            
            // Check health first to avoid navigating to a dead NXDOMAIN URL
            const health = await this.checkHealth();
            if (!health.ok) {
                return {
                    error: {
                        message: `Cannot reach Supabase host at ${getActiveUrl()}. The project may be paused in Supabase Dashboard (DNS NXDOMAIN) or the URL is invalid.`,
                        isNetworkOrDnsError: true
                    }
                };
            }

            try {
                const { data, error } = await window.supabaseClient.auth.signInWithOAuth({
                    provider: provider,
                    options: {
                        redirectTo: window.location.origin + window.location.pathname
                    }
                });
                return { data, error };
            } catch (e) {
                return { error: e };
            }
        }

        // Sign Out
        static async signOut() {
            if (!this.isInitialized()) return;
            try {
                await window.supabaseClient.auth.signOut();
            } catch (e) {
                console.warn("Sign out error:", e);
            }
            localStorage.removeItem('dv_prep_dataset'); // Clear local answers cache on signout
            window.location.reload();
        }

        // Fetch progress from Supabase
        static async fetchProgress() {
            const user = await this.getUser();
            if (!user) return {};

            try {
                const { data, error } = await window.supabaseClient
                    .from('user_progress')
                    .select('page_id, question_id, code, stars, status')
                    .eq('user_id', user.id);

                if (error) {
                    console.warn("Failed to fetch progress from DB:", error);
                    return {};
                }

                // Format structured progress mapping back to localStorage style
                const progressMap = {};
                (data || []).forEach(item => {
                    if (!progressMap[item.page_id]) {
                        progressMap[item.page_id] = {};
                    }
                    progressMap[item.page_id][item.question_id] = {
                        code: item.code,
                        stars: item.stars,
                        status: item.status
                    };
                });
                return progressMap;
            } catch (e) {
                console.warn("Progress fetch exception:", e);
                return {};
            }
        }

        // Sync current state to Supabase
        static async saveProgress(pageId, questionId, code, stars, status) {
            const user = await this.getUser();
            if (!user) return;

            const payload = {
                user_id: user.id,
                page_id: pageId,
                question_id: questionId,
                code: code,
                stars: stars,
                status: status,
                updated_at: new Date().toISOString()
            };

            try {
                const { error } = await window.supabaseClient
                    .from('user_progress')
                    .upsert(payload, { onConflict: 'user_id,page_id,question_id' });

                if (error) {
                    console.warn("Failed to sync progress data to DB:", error);
                }
            } catch (e) {
                console.warn("Progress sync exception:", e);
            }
        }
    }

    window.AuthManager = AuthManager;
})();
