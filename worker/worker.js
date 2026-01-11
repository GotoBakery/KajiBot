/**
 * Discord Bot (KajiBot) - Config Sheet Version
 */

let CACHE_DATA = null;
let CACHE_TIME = 0;
const CACHE_DURATION_MS = 10 * 60 * 1000;

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (request.method === 'GET' && url.pathname === '/register') return await registerCommands(env);
        if (request.method === 'GET' && url.pathname === '/reset') {
            CACHE_DATA = null;
            return new Response("Cache cleared.");
        }

        if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

        const signature = request.headers.get('x-signature-ed25519');
        const timestamp = request.headers.get('x-signature-timestamp');
        const body = await request.text();

        if (!signature || !timestamp || !body) return new Response('Bad Request', { status: 400 });

        const isValid = await verify(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
        if (!isValid) return new Response('Invalid Signature', { status: 401 });

        const interaction = JSON.parse(body);
        const type = interaction.type;

        if (type === 1) return jsonResponse({ type: 1 });

        // ログ送信
        if (type !== 2) {
            ctx.waitUntil(
                fetch(env.GAS_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: body
                })
            );
        }

        if (type === 2 && interaction.data.name === 'panel') {
            if (CACHE_DATA && (Date.now() - CACHE_TIME < CACHE_DURATION_MS)) {
                return handleRootPanel(CACHE_DATA, false);
            }
            return handleDeferredPanel(interaction, env, ctx);
        }

        if (type === 3) {
            if (interaction.data.custom_id === 'action:refresh') {
                return handleDeferredPanel(interaction, env, ctx, true);
            }

            if (!CACHE_DATA || (Date.now() - CACHE_TIME > CACHE_DURATION_MS)) {
                try {
                    CACHE_DATA = await fetchDataFromGas(env);
                    CACHE_TIME = Date.now();
                } catch (e) {
                    return jsonResponse({ type: 4, data: { content: "データ読み込み失敗", flags: 64 } });
                }
            }
            return handleButton(interaction, CACHE_DATA, env, ctx);
        }

        if (type === 5) return handleModal(interaction);

        return new Response('Unknown Type', { status: 400 });
    }
};

// --- ロジック ---

function handleDeferredPanel(interaction, env, ctx, forceRefresh = false) {
    ctx.waitUntil(
        (async () => {
            try {
                const data = await fetchDataFromGas(env);
                CACHE_DATA = data;
                CACHE_TIME = Date.now();

                const responseData = createRootPanelPayload(data);
                const appId = env.APPLICATION_ID;
                const token = interaction.token;
                const url = `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`;

                await fetch(url, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(responseData)
                });
            } catch (e) { }
        })()
    );

    const type = interaction.type === 3 ? 6 : 5;
    return jsonResponse({ type: type });
}

function handleRedemption(interaction, env, ctx) {
    ctx.waitUntil(
        (async () => {
            try {
                let data = CACHE_DATA;
                if (!data) data = await fetchDataFromGas(env);

                const stats = data.stats;
                const users = Object.keys(stats).map(u => ({ name: u, points: stats[u] })).sort((a, b) => b.points - a.points);

                if (users.length === 0) return;

                const leader = users[0];
                const runnerUp = users[1] || { name: "No one", points: 0 };
                const gap = leader.points - runnerUp.points;

                // 0ポイント差でも「清算」ログを残し、画面更新を行うために続行
                // if (gap <= 0) return; 

                await fetch(env.GAS_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'redemption',
                        user: leader.name,
                        points: -gap
                    })
                });

                const newData = await fetchDataFromGas(env);
                CACHE_DATA = newData;
                CACHE_TIME = Date.now();

                const responseData = createRootPanelPayload(newData);
                const appId = env.APPLICATION_ID;
                const token = interaction.token;
                const url = `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`;

                await fetch(url, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(responseData)
                });
            } catch (e) {
                console.error("Redemption Error:", e);
            }
        })()
    );

    return jsonResponse({ type: 6 });
}

async function fetchDataFromGas(env) {
    const res = await fetch(env.GAS_WEBHOOK_URL, { method: 'GET' });
    if (!res.ok) throw new Error("GAS Fetch Failed");
    return await res.json();
}

function createRootPanelPayload(data) {
    const { menu, stats, config } = data;

    // Configを渡してメッセージ計算
    const { message, color, fields, gap } = calculateGapDisplay(stats, config || []);

    const rows = [];
    let currentRow = { type: 1, components: [] };

    const categories = Object.keys(menu);

    categories.forEach(catName => {
        if (currentRow.components.length >= 3) {
            rows.push(currentRow);
            currentRow = { type: 1, components: [] };
        }
        // カテゴリ内に「RESET」または「マイナスポイント」のタスクが含まれているかチェック
        const categoryData = menu[catName];
        const isRewardCategory = categoryData && categoryData.tasks.some(t => t.points === 'RESET' || (typeof t.points === 'number' && t.points < 0));

        currentRow.components.push({
            type: 2, style: isRewardCategory ? 3 : 1, // Green if reward, else Blue
            label: catName, custom_id: `cat:${catName}`
        });
    });
    rows.push(currentRow);

    // 名もなき家事 & 更新
    const systemRow = { type: 1, components: [] };
    systemRow.components.push({
        type: 2, style: 2, label: "👻 名もなき家事", custom_id: "task:nameless:その他"
    });
    systemRow.components.push({
        type: 2, style: 2, label: "🔄 更新", custom_id: "action:refresh"
    });
    rows.push(systemRow);

    return {
        content: "",
        embeds: [{
            title: "📊 現在のポイント",
            description: message,
            color: color,
            fields: fields
        }],
        components: rows
    };
}

function calculateGapDisplay(stats, config) {
    const users = Object.keys(stats);
    if (users.length === 0) {
        return {
            message: "まだ記録がありません。", color: 0x95A5A6, fields: [], gap: 0
        };
    }

    const sortedUsers = users.map(u => ({ name: u, points: stats[u] }))
        .sort((a, b) => b.points - a.points);

    const leader = sortedUsers[0];
    const runnerUp = sortedUsers[1] || { name: "No one", points: 0 };
    const gap = leader.points - runnerUp.points;

    let message = "平和です。";
    let color = 0x5865F2;

    // --- メッセージ決定ロジック ---
    if (config && config.length > 0) {
        // Configがある場合: Thresholdの大きい順に適合チェック
        const sortedConfig = config.sort((a, b) => b.threshold - a.threshold);
        // fallback
        const match = sortedConfig.find(c => gap >= c.threshold);
        if (match) {
            message = match.message;
            if (match.color) {
                const hex = match.color.replace('#', '');
                color = parseInt(hex, 16) || 0x5865F2;
            }
        } else {
            // 設定範囲未満の場合 (例 threshold 100~ しか設定がない場合の 0~99)
            // 一番低い設定を使うか、デフォルトを使うか。
            // ここでは一番低いものを使うか、「平和」とする。
            message = "平和です。";
            color = 0x57F287; // Green
        }
    } else {
        // Configがない場合: デフォルトロジック
        if (gap < 100) {
            message = "🕊️ **平和です。お互い感謝を忘れずに！**\n接戦です！二人とも素晴らしい貢献度です👏";
            color = 0x57F287;
        } else if (gap < 300) {
            message = "🍰 **差が開いてきました...**\n負けている方はコンビニスイーツを買って帰りましょう！";
            color = 0xF1C40F;
        } else if (gap < 600) {
            message = "🍝 **警告！負担が偏っています！**\n感謝のランチをご馳走して清算しましょう。";
            color = 0xE67E22;
        } else {
            message = "🚨 **緊急事態！負担過多です！**\nマッサージ または 休日の完全自由時間 を献上してください！";
            color = 0xED4245;
        }
    }

    return {
        message: message,
        color: color,
        gap: gap,
        fields: sortedUsers.map((u, i) => ({
            name: `${i === 0 ? "👑" : "🛡️"} ${u.name}`,
            value: `**${u.points} pt**`,
            inline: true
        })).concat([{ name: "⚡ ポイント差", value: `**${gap} pt**`, inline: true }])
    };
}

function handleRootPanel(data, isUpdate = false) {
    const payload = createRootPanelPayload(data);
    return jsonResponse({ type: isUpdate ? 7 : 4, data: payload });
}

function handleCategoryPanel(catName, data) {
    const category = data.menu[catName];
    if (!category) return handleRootPanel(data, true);

    const rows = [];
    let currentRow = { type: 1, components: [] };

    category.tasks.forEach(t => {
        if (currentRow.components.length >= 3) {
            rows.push(currentRow);
            currentRow = { type: 1, components: [] };
        }
        // RESET または マイナスポイント（労い）の場合は緑ボタン
        if (t.points === 'RESET' || (typeof t.points === 'number' && t.points < 0)) {
            currentRow.components.push({
                type: 2, style: 3, // Green
                label: t.points === 'RESET' ? `🔄 ${t.name}` : `${t.name} (${t.points}pt)`,
                custom_id: `task:${catName}:${t.name}`
            });
        } else {
            currentRow.components.push({
                type: 2, style: 1, label: `${t.name} (${t.points}pt)`, custom_id: `task:${catName}:${t.name}`
            });
        }
    });
    rows.push(currentRow);
    rows.push({
        type: 1,
        components: [{ type: 2, style: 2, label: "👻 名もなき家事", custom_id: `task:nameless:${catName}` }]
    });
    rows.push({
        type: 1,
        components: [{ type: 2, style: 2, label: "↩️ 戻る", custom_id: "action:back" }]
    });

    return jsonResponse({
        type: 7,
        data: {
            embeds: [{
                title: `${catName}`,
                description: "タスクを選んでください",
                color: 0x57F287
            }],
            components: rows
        }
    });
}

function handleButton(interaction, data, env, ctx) {
    const customId = interaction.data.custom_id;
    if (customId === 'action:back') return handleRootPanel(data, true);
    if (customId.startsWith('cat:')) return handleCategoryPanel(customId.replace('cat:', ''), data);

    if (customId.startsWith('task:nameless:')) {
        const catName = customId.replace('task:nameless:', '');
        return jsonResponse({
            type: 9,
            data: {
                custom_id: `modal:nameless:${catName}`,
                title: `名もなき家事 (${catName})`,
                components: [{
                    type: 1, components: [{ type: 4, custom_id: "input_task", label: "やったこと", style: 1, required: true }]
                }, {
                    type: 1, components: [{ type: 4, custom_id: "input_points", label: "ポイント", style: 1, value: "5", required: true }]
                }]
            }
        });
    }

    if (customId.startsWith('task:')) {
        const parts = customId.split(':');
        const catName = parts[1];
        const taskName = parts.slice(2).join(':');

        if (data.menu[catName]) {
            const task = data.menu[catName].tasks.find(t => t.name === taskName);
            if (task && task.points === 'RESET') {
                return handleRedemption(interaction, env, ctx);
            }
        }

        return jsonResponse({
            type: 4,
            data: { content: `✅ **${taskName}** を記録しました！`, flags: 64 }
        });
    }
    return jsonResponse({ type: 4, data: { content: "Unknown Button" } });
}

function handleModal(interaction) {
    return jsonResponse({ type: 4, data: { content: "✅ 名もなき家事を記録しました！", flags: 64 } });
}

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

async function registerCommands(env) {
    const token = env.DISCORD_BOT_TOKEN;
    const appId = env.APPLICATION_ID;
    if (!token || !appId) return new Response("Error: Missing Env Vars", { status: 500 });
    const url = `https://discord.com/api/v10/applications/${appId}/commands`;
    const commands = [{ name: "panel", description: "家事記録パネルを表示します", type: 1 }];
    const response = await fetch(url, { method: "PUT", headers: { "Authorization": `Bot ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(commands) });
    if (response.ok) return new Response("Success! Commands registered.");
    else return new Response("Error: " + await response.text(), { status: 500 });
}

async function verify(body, signature, timestamp, publicKey) {
    try {
        const key = await crypto.subtle.importKey("raw", hexToBuf(publicKey), { name: "NODE-ED25519", namedCurve: "NODE-ED25519" }, false, ["verify"]);
        const encoder = new TextEncoder();
        const data = encoder.encode(timestamp + body);
        const sig = hexToBuf(signature);
        return await crypto.subtle.verify("NODE-ED25519", key, sig, data);
    } catch (err) {
        try {
            const key = await crypto.subtle.importKey("raw", hexToBuf(publicKey), { name: "Ed25519" }, false, ["verify"]);
            const encoder = new TextEncoder();
            const data = encoder.encode(timestamp + body);
            const sig = hexToBuf(signature);
            return await crypto.subtle.verify("Ed25519", key, sig, data);
        } catch (e) { return false; }
    }
}
function hexToBuf(hex) {
    const view = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        view[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return view.buffer;
}
