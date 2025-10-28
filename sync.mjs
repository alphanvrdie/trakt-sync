#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_FILE = join(__dirname, 'trakt-sync-config.json');

const colors = {
    red: (text) => `\x1b[31m${text}\x1b[0m`,
    green: (text) => `\x1b[32m${text}\x1b[0m`,
    yellow: (text) => `\x1b[33m${text}\x1b[0m`,
    blue: (text) => `\x1b[34m${text}\x1b[0m`,
    cyan: (text) => `\x1b[36m${text}\x1b[0m`,
};

class ManualSync {
    constructor() {
        this.config = null;
    }

    async loadConfig() {
        try {
            const data = await readFile(CONFIG_FILE, 'utf8');
            this.config = JSON.parse(data);
            return true;
        } catch (error) {
            console.log(colors.red('No configuration found. Please run: npm run setup'));
            return false;
        }
    }

    async saveConfig() {
        await writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2));
    }

    async fetchJSON(url, options = {}) {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
    }

    async getSimklWatched() {
        console.log('Fetching Simkl watch history...');
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

        console.log(colors.green('✓ Simkl watch history fetched successfully.'));
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
        console.log('Refreshing Trakt token...');
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
            await this.saveConfig();
            console.log(colors.green('✓ Trakt token refreshed.'));
        } else {
            throw new Error('Failed to refresh Trakt token');
        }
    }

    async initializeTrakt() {
        // Test the connection
        const response = await this.traktRequest('https://api.trakt.tv/users/settings');
        if (response.ok) {
            console.log(colors.green('✓ Trakt connection successful.'));
        } else {
            throw new Error('Trakt connection test failed');
        }
    }

    async sync() {
        if (!await this.loadConfig()) {
            process.exit(1);
        }

        console.log(colors.cyan('Starting manual sync...'));

        try {
            const watched = await this.getSimklWatched();
            await this.initializeTrakt();

            const traktObject = {
                movies: [],
                shows: []
            };

            // Process movies
            watched.movies?.forEach(movie => {
                if (!movie.last_watched_at) return;
                traktObject.movies.push({
                    watched_at: movie.last_watched_at,
                    ids: {
                        imdb: movie.movie.ids.imdb,
                        tmdb: movie.movie.ids.tmdb
                    }
                });
            });

            // Process shows
            watched.shows?.forEach(show => {
                if (!show.last_watched_at) return;
                const seasons = show.seasons?.map(season => ({
                    number: season.number,
                    episodes: season.episodes?.map(episode => ({
                        number: episode.number,
                        watched_at: episode.last_watched_at || show.last_watched_at
                    })).filter(ep => ep) || []
                })).filter(season => season.episodes.length > 0) || [];

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

            // Process anime
            watched.anime?.forEach(anime => {
                if (!anime.last_watched_at) return;
                const seasons = anime.seasons?.map(season => ({
                    number: season.number,
                    episodes: season.episodes?.map(episode => ({
                        number: episode.number,
                        watched_at: episode.last_watched_at || anime.last_watched_at
                    })).filter(ep => ep) || []
                })).filter(season => season.episodes.length > 0) || [];

                if (seasons.length > 0) {
                    traktObject.shows.push({
                        watched_at: anime.last_watched_at,
                        ids: {
                            imdb: anime.show.ids.imdb,
                            tmdb: anime.show.ids.tmdb
                        },
                        seasons: seasons
                    });
                }
            });

            console.log(`Syncing ${traktObject.movies.length} movies and ${traktObject.shows.length} shows...`);

            const response = await this.traktRequest('https://api.trakt.tv/sync/history', {
                method: 'POST',
                body: JSON.stringify(traktObject)
            });

            if (response.ok) {
                const result = await response.json();
                console.log(colors.green(`✓ Sync completed! Added ${result.added?.movies || 0} movies and ${result.added?.episodes || 0} episodes.`));
            } else {
                console.log(colors.red(`✗ Sync failed: ${response.status} ${response.statusText}`));
            }
        } catch (error) {
            console.log(colors.red(`✗ Sync failed: ${error.message}`));
            process.exit(1);
        }
    }
}

// Run sync
const sync = new ManualSync();
sync.sync().catch(error => {
    console.error(colors.red(`Error: ${error.message}`));
    process.exit(1);
});