#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'fs/promises';
import { createInterface } from 'readline';
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

class Setup {
    constructor() {
        this.config = {};
    }

    async askQuestion(question) {
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer);
            });
        });
    }

    async confirmQuestion(question) {
        const answer = await this.askQuestion(question + ' (y/n) ');
        return answer.toLowerCase().startsWith('y');
    }

    async fetchJSON(url, options = {}) {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
    }

    async getSimklPin(clientId) {
        console.log(colors.cyan('Getting Simkl PIN...'));
        const data = await this.fetchJSON(`https://api.simkl.com/oauth/pin?client_id=${clientId}`);
        
        console.log(colors.cyan(`Please authorize the Simkl application by visiting: ${data.verification_url}`));
        console.log(colors.cyan(`Use this code: ${data.user_code}`));
        
        await this.askQuestion('Press Enter once you have authorized...');
        
        const tokenData = await this.fetchJSON(`https://api.simkl.com/oauth/pin/${data.user_code}?client_id=${clientId}`);
        return tokenData.access_token;
    }

    async getTraktPin(clientId, clientSecret) {
        console.log(colors.blue('Getting Trakt PIN...'));
        
        const response = await fetch('https://api.trakt.tv/oauth/device/code', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                client_id: clientId
            })
        });

        const data = await response.json();
        
        console.log(colors.blue(`Authorize the Trakt application via: ${data.verification_url}`));
        console.log(colors.blue(`Use this code: ${data.user_code}`));
        
        console.log('Waiting for authorization...');
        
        // Poll for authorization
        const startTime = Date.now();
        while (Date.now() - startTime < data.expires_in * 1000) {
            await new Promise(resolve => setTimeout(resolve, data.interval * 1000));
            
            const tokenResponse = await fetch('https://api.trakt.tv/oauth/device/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    code: data.device_code,
                    client_id: clientId,
                    client_secret: clientSecret
                })
            });

            if (tokenResponse.status === 200) {
                const tokenData = await tokenResponse.json();
                console.log(colors.green('✓ Trakt authorization successful.'));
                return tokenData;
            } else if (tokenResponse.status === 400) {
                // Still pending, continue waiting
                continue;
            } else {
                throw new Error(`Trakt authorization failed: ${tokenResponse.status}`);
            }
        }

        throw new Error('Trakt authorization timed out');
    }

    async runSetup() {
        console.log(colors.cyan('=== Trakt Sync Setup ==='));

        const simklClientId = await this.askQuestion('Enter your Simkl Client ID: ');
        const traktClientId = await this.askQuestion('Enter your Trakt Client ID: ');
        const traktClientSecret = await this.askQuestion('Enter your Trakt Client Secret: ');

        this.config = {
            simkl_client_id: simklClientId,
            trakt_client_id: traktClientId,
            trakt_client_secret: traktClientSecret
        };

        // Save initial config
        await writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2));
        console.log(colors.green('✓ Initial configuration saved.'));

        console.log(colors.yellow('Now authorizing with Simkl and Trakt...'));

        // Get Simkl token
        try {
            const simklToken = await this.getSimklPin(simklClientId);
            this.config.simkl_access_token = simklToken;
            await writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2));
            console.log(colors.green('✓ Simkl authorization successful.'));
        } catch (error) {
            console.log(colors.red(`✗ Simkl authorization failed: ${error.message}`));
            throw error;
        }

        // Get Trakt token
        try {
            const traktTokens = await this.getTraktPin(traktClientId, traktClientSecret);
            this.config.trakt_tokens = traktTokens;
            await writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2));
            console.log(colors.green('✓ Trakt authorization successful.'));
        } catch (error) {
            console.log(colors.red(`✗ Trakt authorization failed: ${error.message}`));
            throw error;
        }

        console.log(colors.green('✓ Setup completed successfully!'));
        console.log(colors.cyan('You can now run: npm run sync'));
        console.log(colors.cyan('Or set up Docker with: docker-compose up -d trakt-sync-cron'));
    }
}

// Run setup
const setup = new Setup();
setup.runSetup().catch(error => {
    console.error(colors.red(`Setup failed: ${error.message}`));
    process.exit(1);
});