/**
 * KajiBot (家事記録・労いBot) - GAS Backend
 */

// --- 設定: ユーザー名マッピング ---
// Discordのユーザー名を「夫」「妻」などに統一します。
// スクリプトプロパティ 'USER_MAPPING_JSON' に {"DiscordName": "夫"} の形式で設定してください。

// --- 設定: ミルク目標値 ---
// --- 設定: ミルク目標値 ---
// スクリプトプロパティ 'DAILY_MILK_TARGET' から取得 (デフォルト: 800)

function normalizeUser(name) {
    try {
        const props = PropertiesService.getScriptProperties();
        const json = props.getProperty('USER_MAPPING_JSON');
        if (!json) return name;
        
        const map = JSON.parse(json);
        return map[name] || name;
    } catch (e) {
        console.error("User Mapping Error:", e);
        return name;
    }
}


// --- 1. データ受信・記録 (POST) ---
function doPost(e) {
    try {
        const postData = JSON.parse(e.postData.contents);
        const type = postData.type;

        if (type === 3 || type === 5 || type === 'redemption') {
            recordInteraction(postData);
        }
        return ContentService.createTextOutput("OK");
    } catch (err) {
        Logger.log("Error: " + err.toString());
        return ContentService.createTextOutput("Error");
    }
}

function recordInteraction(data) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('log');
    if (!sheet) return;

    checkAndAddCategoryColumn(sheet);

    const timestamp = new Date();
    let rawUser = data.member ? (data.member.nick || data.member.user.username) : data.user;
    let user = normalizeUser(rawUser);

    let category = "📂その他";
    let task = "";
    let points = 0;

    // Redemption
    if (data.type === 'redemption') {
        category = "System";
        task = "🎁 労いによる清算 (リセット)";
        points = data.points;
    }

    // Type 3
    if (data.type === 3) {
        const customId = data.data.custom_id;
        if (customId.startsWith("task:") && !customId.startsWith("task:nameless:")) {
            const parts = customId.split(":");
            if (parts.length >= 3) {
                category = parts[1];
                task = parts.slice(2).join(':');
                const p = getPointsFromMaster(task);
                points = (p === 'RESET') ? 0 : p;
            }
        }
    }

    // Type 5
    if (data.type === 5) {
        const customId = data.data.custom_id;
        if (customId.startsWith("modal:nameless:")) {
            const parts = customId.split(":");
            if (parts.length >= 3) category = parts.slice(2).join(':');
        }

        const rows = data.data.components;
        rows.forEach(row => {
            row.components.forEach(c => {
                if (c.custom_id === 'input_task') task = c.value;
                if (c.custom_id === 'input_points') points = parseInt(c.value, 10) || 0;
            });
        });
    }

    if (task) {
        sheet.appendRow([timestamp, user, category, task, points]);
    }
}

function checkAndAddCategoryColumn(sheet) {
    const headers = sheet.getRange("A1:E1").getValues()[0];
    if (headers[2] !== 'category') {
        // Placeholder
    }
}

// --- 2. Masterデータ & 統計 & 設定配信 (GET) ---
function doGet(e) {
    // 既存のWorkerからのアクセス対応 (JSON)
    if (e.parameter.type === 'json') {
        const payload = {
            menu: getMasterData(),
            stats: getStats(),
            config: getConfigData()
        };
        return ContentService.createTextOutput(JSON.stringify(payload))
            .setMimeType(ContentService.MimeType.JSON);
    }

    // Webブラウザからのアクセス (HTML)
    return HtmlService.createTemplateFromFile('index')
        .evaluate()
        .setTitle('KajiBot Dashboard')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// --- 3. Web Dashboard用 API ---
function getDashboardData() {
    // 1. Config & Master (Small data, fetch separately)
    const config = getConfigData();
    const menu = getMasterData();
    
    // User Mapping
    let availableUsers = ["夫", "妻"];
    try {
        const props = PropertiesService.getScriptProperties();
        const json = props.getProperty('USER_MAPPING_JSON');
        if (json) {
            const map = JSON.parse(json);
            const values = Object.values(map);
            if (values.length > 0) {
                availableUsers = [...new Set(values)];
            }
        }
    } catch (e) {
        console.error(e);
    }

    // --- 2. Log Sheet Processing (Single Access) ---
    const stats = {};
    const recentLogs = [];
    let gap = 0;

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('log');
    if (sheet) {
        // Fetch ALL data once: getDataRange().getValues()
        // Row 1 is Header
        const values = sheet.getDataRange().getValues();
        
        if (values.length > 1) {
            const dataRows = values.slice(1); // Remove header (Index 0)

            // A: Calculate Stats
            dataRows.forEach(row => {
                const user = row[1];
                const points = Number(row[4]);
                if (user && !isNaN(points)) {
                    stats[user] = (stats[user] || 0) + points;
                }
            });

            // B: Recent Logs (Last 3)
            // Use reverse loop or slice from end on memory array
            const lastLogs = dataRows.slice(-3).reverse();
            
            const now = new Date();
            const timeZone = Session.getScriptTimeZone();
            const todayStr = Utilities.formatDate(now, timeZone, 'yyyyMMdd');
            
            const yesterday = new Date(now);
            yesterday.setDate(now.getDate() - 1);
            const yesterdayStr = Utilities.formatDate(yesterday, timeZone, 'yyyyMMdd');

            lastLogs.forEach(row => {
                 // row: [Timestamp, User, Category, Task, Points]
                 const d = new Date(row[0]);
                 let dateStr = "";
                 const logDateStr = Utilities.formatDate(d, timeZone, 'yyyyMMdd');
                 
                 // Date Formatting
                 if (logDateStr === todayStr) {
                    dateStr = Utilities.formatDate(d, timeZone, "HH:mm");
                 } else if (logDateStr === yesterdayStr) {
                    dateStr = "昨日 " + Utilities.formatDate(d, timeZone, "HH:mm");
                 } else {
                    dateStr = Utilities.formatDate(d, timeZone, "M/d HH:mm");
                 }

                 recentLogs.push({
                     timestamp: dateStr,
                     user: row[1],
                     task: row[3]
                 });
            });
        }
    }

    // Gap Calculation
    const users = Object.keys(stats);
    if (users.length >= 2) {
        const sortedUsers = users.map(u => ({ name: u, points: stats[u] }))
            .sort((a, b) => b.points - a.points);
        gap = sortedUsers[0].points - sortedUsers[1].points;
    }

    return {
        stats: stats,
        menu: menu,
        config: config,
        gap: gap,
        users: availableUsers,
        recentLogs: recentLogs
    };
}

function logTaskFromWeb(rawUser, taskName, memo) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('log');
    if (!sheet) return "Error: No log sheet";

    checkAndAddCategoryColumn(sheet);
    
    // ユーザー名統一
    const user = normalizeUser(rawUser);
    const timestamp = new Date();
    
    // マスタデータからカテゴリとポイントを検索
    const masterSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('master');
    const masterData = masterSheet.getDataRange().getValues();
    
    let category = "📂その他";
    let points = 0;
    
    // 検索 (Header skip)
    for (let i = 1; i < masterData.length; i++) {
        // masterData[i][1] is TaskName
        if (masterData[i][1] === taskName) {
            category = masterData[i][0]; // Category
            const p = masterData[i][2];  // Points
            
            if (String(p).toUpperCase() === 'RESET') {
                points = 0; // Webからの記録ではRESET値は0扱いとする
            } else {
                points = Number(p) || 0;
            }
            break;
        }
    }

    // 記録
    // logTaskFromWeb: memo があれば F列(index 5) に記録
    const rowData = [timestamp, user, category, taskName, points ];
    if (memo !== undefined && memo !== null) {
        rowData[5] = memo; 
    }
    
    sheet.appendRow(rowData);

    // Discordへ通知
    // ミルクの場合は詳細を表示
    if (memo) {
        sendDiscordNotification(user, `${taskName} (${memo}ml)`, points);
    } else {
        sendDiscordNotification(user, taskName, points);
    }
    
    return "Success";
}

function sendDiscordNotification(user, taskName, points) {
    const props = PropertiesService.getScriptProperties();
    const webhookUrl = props.getProperty('DISCORD_WEBHOOK_URL');
    if (!webhookUrl) return;

    const payload = {
        content: `🆕 **Web**: ${user} が **${taskName}** (${points}pt) を完了しました！`
    };

    UrlFetchApp.fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        payload: JSON.stringify(payload)
    });
}

function logReset(rawUser) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('log');
    if (!sheet) return getDashboardData(); 

    // 1. Calculate Current Stats (Simple Aggregation)
    const stats = {};
    const values = sheet.getDataRange().getValues();
    if (values.length > 1) {
        // Skip header
        for (let i = 1; i < values.length; i++) {
            const row = values[i];
            const u = row[1];
            const p = Number(row[4]);
            if (u && !isNaN(p)) {
                stats[u] = (stats[u] || 0) + p;
            }
        }
    }

    // 2. Identify Gap & Trailing User
    const users = Object.keys(stats);
    if (users.length < 2) return getDashboardData(); 

    // Sort users by points ASC
    const sorted = users.map(u => ({ name: u, points: stats[u] })).sort((a,b) => a.points - b.points);
    
    const trailingUser = sorted[0].name;
    // const leadingUser = sorted[sorted.length - 1].name;
    const gap = sorted[sorted.length - 1].points - sorted[0].points;

    if (gap > 0) {
        // 3. Add Offset Log
        const timestamp = new Date();
        const category = "System"; 
        const taskName = "🎫 何でも言うこと聞く券";
        const points = gap; // Add gap to trailing user

        sheet.appendRow([timestamp, trailingUser, category, taskName, points]);

        // 4. Notify Discord
        sendDiscordNotification(trailingUser, taskName + " (清算)", points);
    }

    // 5. Return updated data
    return getDashboardData();
}

function undoLastLog(rawUser) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('log');
    if (!sheet) return getDashboardData(); // Fail safe

    // ユーザー名統一
    const user = normalizeUser(rawUser);
    const lastRow = sheet.getLastRow();
    
    // 逆順探索でユーザーの最後の記録を探す
    // ヘッダーは1行目なのでデータは2行目から。
    if (lastRow < 2) return getDashboardData();

    // パフォーマンスのため、直近200件程度を確認すれば十分なはず
    const searchLimit = 200; 
    const startRow = Math.max(2, lastRow - searchLimit + 1);
    // getRange(row, col, numRows, numCols)
    const range = sheet.getRange(startRow, 1, lastRow - startRow + 1, 5);
    const values = range.getValues();
    
    let targetRow = -1;
    let taskName = "";
    
    // valuesは 0-indexed (配列)。スプレッドシート上の行番号は startRow + i
    // 後ろから見ていく
    for (let i = values.length - 1; i >= 0; i--) {
        // Logのカラム: Timestamp, User, Category, Task, Points
        // Userは Column B -> Index 1
        if (values[i][1] === user) {
            targetRow = startRow + i;
            taskName = values[i][3]; // Task Description
            break;
        }
    }
    
    if (targetRow !== -1) {
        sheet.deleteRow(targetRow);
        sendDiscordUndoNotification(user, taskName);
    }
    
    return getDashboardData();
}

function sendDiscordUndoNotification(user, taskName) {
    const props = PropertiesService.getScriptProperties();
    const webhookUrl = props.getProperty('DISCORD_WEBHOOK_URL');
    if (!webhookUrl) return;

    const payload = {
        content: `⚠️ **${user}** が直近の記録 (**${taskName}**) を取り消しました。`
    };

    UrlFetchApp.fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        payload: JSON.stringify(payload)
    });
}


function getConfigData() {
    // Read from 'config' sheet (User request implied 'config')
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('config');
    if (!sheet) {
        console.warn("config sheet not found.");
        return []; 
    }

    // getDataRange includes header
    const data = sheet.getDataRange().getValues();
    const config = [];

    // Header is row 0, data starts at row 1
    // Columns: [Limit(Threshold), Message, Color]
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const limit = Number(row[0]);
        const text = row[1];
        const color = row[2];

        // Basic validation
        if (!isNaN(limit) && text) {
            config.push({
                limit: limit,
                text: text,
                color: color || ""
            });
        }
    }

    // Sort by limit ASC
    config.sort((a, b) => a.limit - b.limit);

    return config;
}

function getStats() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('log');
    if (!sheet) return {};

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};

    const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    const totals = {};

    data.forEach(row => {
        const user = row[1];
        const points = Number(row[4]);
        if (user && !isNaN(points)) {
            totals[user] = (totals[user] || 0) + points;
        }
    });
    return totals;
}

function getMasterData() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('master');
    if (!sheet) return {};

    const data = sheet.getDataRange().getValues();
    const menu = {};

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const category = row[0];
        const taskName = row[1];
        const pointsRaw = row[2];

        if (!category || !taskName) continue;

        if (!menu[category]) {
            menu[category] = { label: category, tasks: [] };
        }

        let points = 0;
        if (String(pointsRaw).toUpperCase() === 'RESET') {
            points = 'RESET';
        } else {
            points = Number(pointsRaw) || 0;
        }

        menu[category].tasks.push({
            name: taskName,
            points: points
        });
    }
    return menu;
}

function getPointsFromMaster(taskName) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('master');
    if (!sheet) return 0;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][1] === taskName) {
            const val = data[i][2];
            if (String(val).toUpperCase() === 'RESET') return 'RESET';
            return Number(val) || 0;
        }
    }
    return 0;
}

// --- Milk Tracker API ---
function getMilkData() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('log');
    if (!sheet) return { timeline: [], dailyTotals: {} };

    // 直近7日分取得等のロジック
    // パフォーマンス考慮: 全件取得してフィルタリング
    // timestamp, user, category, task, points, memo(F列)
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { timeline: [], dailyTotals: {} };

    const rows = data.slice(1);
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const timeZone = Session.getScriptTimeZone();
    
    // 抽出
    const milkLogs = rows.filter(r => {
        const d = new Date(r[0]);
        // task(index 3) に "ミルク" を含む
        const taskName = String(r[3]);
        return taskName.includes("ミルク") && d >= sevenDaysAgo;
    });

    // 1. Timeline (Reverse order, limit 10)
    const timeline = [];
    const sortedLogs = milkLogs.slice().sort((a,b) => new Date(b[0]) - new Date(a[0])); // DESC
    
    sortedLogs.slice(0, 10).forEach(r => {
        const d = new Date(r[0]);
        const dateStr = Utilities.formatDate(d, timeZone, "M/d HH:mm");
        const amount = Number(r[5]) || 0; // Column F is index 5
        timeline.push({
            time: dateStr,
            rawTime: d.getTime(), // Add raw timestamp for calculation
            user: r[1],
            amount: amount
        });
    });

    // 2. Daily Totals (Last 7 days)
    const dailyTotals = {};
    // Initialize last 7 days keys
    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        const k = Utilities.formatDate(d, timeZone, "yyyy/MM/dd");
        dailyTotals[k] = 0;
    }

    milkLogs.forEach(r => {
        const d = new Date(r[0]);
        const k = Utilities.formatDate(d, timeZone, "yyyy/MM/dd");
        const amount = Number(r[5]) || 0;
        if (dailyTotals.hasOwnProperty(k)) {
            dailyTotals[k] += amount;
        }
    });

    // 3. Target (Configurable from Script Properties)
    let target = 800;
    try {
        const props = PropertiesService.getScriptProperties();
        const val = props.getProperty('DAILY_MILK_TARGET');
        if (val) target = Number(val);
    } catch (e) {
        console.error(e);
    }

    return {
        timeline: timeline,
        dailyTotals: dailyTotals,
        target: target
    };
}

// --- コマンド登録 (変更なし) ---
function registerCommands() {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('DISCORD_BOT_TOKEN');
    const appId = props.getProperty('APPLICATION_ID');
    if (!token || !appId) return;
    const url = `https://discord.com/api/v10/applications/${appId}/commands`;
    const commands = [{ name: "panel", description: "家事記録パネルを表示します", type: 1 }];
    UrlFetchApp.fetch(url, {
        method: "PUT",
        headers: { "Authorization": `Bot ${token}`, "Content-Type": "application/json", "User-Agent": "DiscordBot (https://github.com/discord/discord-api-docs, 1.0.0)" },
        payload: JSON.stringify(commands)
    });
}