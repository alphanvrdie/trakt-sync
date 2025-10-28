#!/usr/bin/env node

// GitHub Actions compatible sync script
class GitHubSync {
    constructor() {
        this.config = this.loadConfig();
    }

    loadConfig() {
        return {
            simkl_client_id: process.env.SIMKL_CLIENT_ID,
            trakt_client_id: process.env.TRAKT_CLIENT_ID,
            trakt_client_secret: process.env.TRAKT_CLIENT_SECRET,
            simkl_access_token: process.env.SIMKL_ACCESS_TOKEN,
            trakt_tokens: process.env.TRAKT_TOKENS ? JSON.parse(process.env.TRAKT_TOKENS) : null
        };
    }

    async fetchJSON(url, options = {}) {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
    }

    async getSimklWatched() {
        console.log('📡 Fetching Simkl watch history...');
        const data = await this.fetchJSON(
            "https://api.simkl.com/sync/all-items/?extended=full&episode_watched_at=yes",
            {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.config.simkl_access_token}`,
                    "simkl-api-key": this.config.simkl_client_id,
                },
            }
        );
        console.log('✅ Simkl watch history fetched successfully.');
        return data;
    }

    async traktRequest(url, options = {}) {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.trakt_tokens.access_token}`,
                'trakt-api-version': '2',
                'trakt-api-key': this.config.trakt_client_id
            }
        };

        const response = await fetch(url, { ...defaultOptions, ...options });
        
        if (response.status === 401) {
            await this.refreshTraktToken();
            defaultOptions.headers.Authorization = `Bearer ${this.config.trakt_tokens.access_token}`;
            return fetch(url, { ...defaultOptions, ...options });
        }

        return response;
    }

    async refreshTraktToken() {
        console.log('🔄 Refreshing Trakt token...');
        const response = await fetch('https://api.trakt.tv/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                refresh_token: this.config.trakt_tokens.refresh_token,
                client_id: this.config.trakt_client_id,
                client_secret: this.config.trakt_client_secret,
                redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
                grant_type: 'refresh_token'
            })
        });

        if (response.ok) {
            this.config.trakt_tokens = await response.json();
            console.log('✅ Trakt token refreshed.');
            // Note: In GitHub Actions, we can't persist the token automatically
            // You'll need to manually update the secret when this happens
            console.log('⚠️  Please update TRAKT_TOKENS secret in GitHub with new tokens');
        } else {
            throw new Error('Failed to refresh Trakt token');
        }
    }

    async sync() {
        console.log(`🚀 Starting GitHub Actions Sync - ${new Date().toISOString()}`);
        
        try {
            const watched = await this.getSimklWatched();
            
            // Test Trakt connection
            console.log('🔗 Testing Trakt connection...');
            const testResponse = await this.traktRequest('https://api.trakt.tv/users/settings');
            if (!testResponse.ok) throw new Error('Trakt connection failed');
            console.log('✅ Trakt connection successful.');

            const traktObject = {
                movies: [],
                shows: []
            };

            // Process movies
            if (watched.movies) {
                watched.movies.forEach(movie => {
                    if (!movie.last_watched_at) return;
                    traktObject.movies.push({
                        watched_at: movie.last_watched_at,
                        ids: {
                            imdb: movie.movie.ids.imdb,
                            tmdb: movie.movie.ids.tmdb
                        }
                    });
                });
            }

            // Process shows
            if (watched.shows) {
                watched.shows.forEach(show => {
                    if (!show.last_watched_at) return;
                    const seasons = show.seasons ? show.seasons.map(season => ({
                        number: season.number,
                        episodes: season.episodes ? season.episodes.map(episode => ({
                            number: episode.number,
                            watched_at: episode.last_watched_at || show.last_watched_at
                        })).filter(ep => ep) : []
                    })).filter(season => season.episodes.length > 0) : [];

                    if (seasons.length > 0) {
                        traktObject.shows.push({
                            watched_at: show.last_watched_at,
                            ids: {
                                imdb: show.show.ids.imdb,
                                tmdb: show.show.ids.tmdb
                            },
                            seasons: seasons
                        });
                    }
                });
            }

            console.log(`📊 Found ${traktObject.movies.length} movies and ${traktObject.shows.length} shows to sync...`);

            if (traktObject.movies.length === 0 && traktObject.shows.length === 0) {
                console.log('ℹ️  No new items to sync.');
                return;
            }

            const response = await this.traktRequest('https://api.trakt.tv/sync/history', {
                method: 'POST',
                body: JSON.stringify(traktObject)
            });

            if (response.ok) {
                const result = await response.json();
                console.log(`✅ Sync completed! Added ${result.added?.movies || 0} movies and ${result.added?.episodes || 0} episodes.`);
            } else {
                throw new Error(`Sync failed: ${response.status}`);
            }
        } catch (error) {
            console.error(`❌ Sync failed: ${error.message}`);
            process.exit(1);
        }
    }
}

// Run the sync
new GitHubSync().sync().catch(console.error);
