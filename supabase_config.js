// Supabase client configuration and Auth utility module
const SUPABASE_URL = "https://gcrpigehmbjnvkiklzwi.supabase.co";
// Reconstructed full JWT key structure from public publishable key prefix
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjcnBpZ2VobWJqbnZraWtsendpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyOTUzMTUsImV4cCI6MjA1ODg3MTMxNX0.sb_publishable_LVg3YKs_mGVtIKTKU3jEsQ_QE57f7gL";

// Initialize Supabase Client
const supabaseClient = (window.supabase && typeof window.supabase.createClient === 'function') ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const supabase = supabaseClient;

class AuthManager {
    static isInitialized() {
        return !!supabase;
    }

    static async getSession() {
        if (!this.isInitialized()) return null;
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) console.error("Session fetch failed:", error);
        return session;
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
        if (!this.isInitialized()) return { error: "Auth client not ready" };
        const { data, error } = await supabase.auth.signUp({ email, password });
        return { data, error };
    }

    // Email/Password Sign In
    static async signIn(email, password) {
        if (!this.isInitialized()) return { error: "Auth client not ready" };
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        return { data, error };
    }

    // Social login (OAuth) helper - handles redirect flows
    static async signInWithOAuth(provider) {
        if (!this.isInitialized()) return { error: "Auth client not ready" };
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: provider,
            options: {
                redirectTo: window.location.href
            }
        });
        return { data, error };
    }

    // Sign Out
    static async signOut() {
        if (!this.isInitialized()) return;
        await supabase.auth.signOut();
        localStorage.removeItem('dv_prep_dataset'); // Clear local answers cache on signout
        window.location.reload();
    }

    // Fetch progress from Supabase
    static async fetchProgress() {
        const user = await this.getUser();
        if (!user) return {};

        const { data, error } = await supabase
            .from('user_progress')
            .select('page_id, question_id, code, stars, status')
            .eq('user_id', user.id);

        if (error) {
            console.error("Failed to fetch progress from DB:", error);
            return {};
        }

        // Format structured progress mapping back to localStorage style
        const progressMap = {};
        data.forEach(item => {
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

        const { error } = await supabase
            .from('user_progress')
            .upsert(payload, { onConflict: 'user_id,page_id,question_id' });

        if (error) {
            console.error("Failed to sync progress data to DB:", error);
        }
    }
}

window.AuthManager = AuthManager;
