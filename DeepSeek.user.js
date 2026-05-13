// ==UserScript==
// @name         DeepSeek 文件夹增强（终极稳定版 + 双层优雅布局）
// @namespace    http://tampermonkey.net/
// @version      6.7
// @description  上下双层优雅布局，解决侧边栏拥挤问题，多选体验更沉浸。
// @author       豆包 & 架构级优化
// @match        https://chat.deepseek.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const log = (...args) => console.log('📂 [DS-Folder]', ...args);
    log("v6.7 双层优雅版启动！");

    // ==========================================
    // 1. 数据中心 (Store)
    // ==========================================
    const Store = {
        KEYS: { FOLDERS: 'ds_folders_v2', MAP: 'ds_chat_folder_map_v2' },
        currentFolder: 'default',
        folders:[],
        map: {},

        init() {
            this.folders = this.safeParse(this.safeGet(this.KEYS.FOLDERS)) || [{ id: 'default', name: '全部会话', isDefault: true }];
            this.map = this.safeParse(this.safeGet(this.KEYS.MAP)) || {};
        },
        safeGet(key) { try { return GM_getValue(key) || localStorage.getItem(key); } catch (e) { return null; } },
        safeSet(key, val) { try { GM_setValue(key, val); } catch (e) {} try { localStorage.setItem(key, val); } catch (e) {} },
        safeParse(str) { try { return JSON.parse(str); } catch (e) { return null; } },
        save() {
            this.safeSet(this.KEYS.FOLDERS, JSON.stringify(this.folders));
            this.safeSet(this.KEYS.MAP, JSON.stringify(this.map));
        },
        addFolder(name) {
            if (!name || this.folders.some(f => f.name === name)) return false;
            this.folders.push({ id: 'folder_' + Date.now(), name });
            this.save();
            return true;
        },
        deleteFolder(id) {
            if (id === 'default') return;
            this.folders = this.folders.filter(f => f.id !== id);
            Object.keys(this.map).forEach(k => { if (this.map[k] === id) delete this.map[k]; });
            if (this.currentFolder === id) this.currentFolder = 'default';
            this.save();
        },
        moveChats(ids, folderId) {
            const idList = Array.isArray(ids) ? ids : [ids];
            idList.forEach(id => {
                if (folderId === 'default') delete this.map[id];
                else this.map[id] = folderId;
            });
            this.save();
        }
    };

    // ==========================================
    // 2. DOM 操作工具 (DOM Utilities)
    // ==========================================
    const DOM = {
        container: null,
        getChats() { return Array.from(document.querySelectorAll('a[href*="/chat/"]')).filter(el => this.extractId(el)); },
        extractId(el) {
            const match = (el.getAttribute('href') || '').match(/\/chat\/(?:s\/)?([a-zA-Z0-9_-]+)/);
            return (match && match[1].length >= 8) ? match[1] : null;
        },
        findContainer() {
            const chats = this.getChats();
            if (!chats.length) return null;
            let el = chats[0].parentElement;
            for (let i = 0; el && i < 8; i++) {
                if (el.querySelectorAll('a[href*="/chat/"]').length >= chats.length) return el;
                el = el.parentElement;
            }
            return el;
        },
        getRow(link) {
            const p = link.parentElement;
            return (p && p.tagName === 'DIV' && p.children.length === 1) ? p : link;
        },
        isDark() {
            return document.documentElement.classList.contains('dark') || window.matchMedia('(prefers-color-scheme: dark)').matches;
        },
        injectStyle() {
            if (document.getElementById('ds-folder-styles')) return;
            const style = document.createElement('style');
            style.id = 'ds-folder-styles';
            style.textContent = `
                /* 多选高亮框 */
                .ds-selected-row {
                    background-color: rgba(59,130,246,0.15) !important;
                    box-shadow: inset 0 0 0 2px #3b82f6 !important;
                    border-radius: 8px !important;
                    transition: all 0.15s ease-in-out;
                }
                /* 优雅的极简滚动条 */
                #ds-tabs::-webkit-scrollbar { height: 3px; }
                #ds-tabs::-webkit-scrollbar-track { background: transparent; }
                #ds-tabs::-webkit-scrollbar-thumb { background: rgba(150, 150, 150, 0.3); border-radius: 3px; }
                #ds-tabs::-webkit-scrollbar-thumb:hover { background: rgba(150, 150, 150, 0.6); }
            `;
            document.head.appendChild(style);
        }
    };

    // ==========================================
    // 3. UI 组件库 (User Interface)
    // ==========================================
    const UI = {
        injectToolbar(container) {
            if (document.getElementById('ds-folder-toolbar')) return;
            DOM.injectStyle();
            const dark = DOM.isDark();
            const txtColor = dark ? '#e0e0e0' : '#111';
            const bdColor = dark ? '#4b5563' : '#d1d5db';
            
            const tb = document.createElement('div');
            tb.id = 'ds-folder-toolbar';
            // 💡 优雅改动：改为 column 上下两行布局
            tb.innerHTML = `
                <div style="padding:10px 12px; display:flex; flex-direction:column; gap:8px; border-bottom:1px solid ${dark ? '#3a3a4a' : '#e5e7eb'}; background:transparent; margin-bottom:4px;">
                    
                    <!-- 第一行：功能操作区 -->
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <!-- 左侧：新建与多选 -->
                        <div id="ds-normal-btns" style="display:flex; gap:6px; align-items:center;">
                            <button id="ds-add-btn" style="padding:5px 10px; border-radius:6px; border:none; background:#3b82f6; color:white; cursor:pointer; font-size:12px; transition:0.1s;">➕ 新建</button>
                            <button id="ds-batch-btn" style="padding:5px 10px; border-radius:6px; border:1px solid ${bdColor}; color:${txtColor}; background:transparent; cursor:pointer; font-size:12px; transition:0.1s;">☑️ 多选</button>
                        </div>
                        
                        <!-- 左侧(多选模式)：取消与移动 -->
                        <div id="ds-batch-btns" style="display:none; gap:6px; align-items:center;">
                            <button id="ds-batch-cancel" style="padding:5px 10px; border-radius:6px; border:none; background:#6b7280; color:white; cursor:pointer; font-size:12px; transition:0.1s;">取消</button>
                            <button id="ds-batch-move" style="padding:5px 10px; border-radius:6px; border:none; background:#10b981; color:white; cursor:pointer; font-size:12px; font-weight:bold; transition:0.1s;">📂 移动已选(0)</button>
                        </div>

                        <!-- 右侧：导入导出 -->
                        <div id="ds-io-btns" style="display:flex; gap:6px; align-items:center;">
                            <button id="ds-exp-btn" title="导出备份" style="padding:4px 6px; border-radius:6px; border:1px solid ${bdColor}; color:${txtColor}; background:transparent; cursor:pointer; font-size:12px;">📤</button>
                            <button id="ds-imp-btn" title="导入备份" style="padding:4px 6px; border-radius:6px; border:1px solid ${bdColor}; color:${txtColor}; background:transparent; cursor:pointer; font-size:12px;">📥</button>
                        </div>
                    </div>

                    <!-- 第二行：文件夹 Tab 区，独占一行 -->
                    <div id="ds-tabs" style="display:flex; gap:5px; width:100%; overflow-x:auto; align-items:center; padding-bottom:3px; scroll-behavior:smooth;"></div>
                </div>
            `;
            container.parentNode.insertBefore(tb, container);

            // 绑定事件
            document.getElementById('ds-add-btn').onclick = () => { if (Store.addFolder(prompt('文件夹名称：'))) App.refresh(); };
            document.getElementById('ds-exp-btn').onclick = () => App.exportData();
            document.getElementById('ds-imp-btn').onclick = () => App.importData();
            
            document.getElementById('ds-batch-btn').onclick = () => App.toggleBatchMode(true);
            document.getElementById('ds-batch-cancel').onclick = () => App.toggleBatchMode(false);
            document.getElementById('ds-batch-move').onclick = (e) => {
                if (App.selectedIds.size === 0) return alert('请先点击列表，选择要移动的会话！');
                UI.showMenu(e.target.getBoundingClientRect(), Array.from(App.selectedIds));
            };

            this.renderTabs();
        },
        renderTabs() {
            const box = document.getElementById('ds-tabs');
            if (!box) return;
            box.innerHTML = '';
            const dark = DOM.isDark();

            Store.folders.forEach(f => {
                const wrap = document.createElement('div');
                wrap.style.cssText = 'display:flex; align-items:center; position:relative; flex-shrink:0;';
                const btn = document.createElement('button');
                btn.textContent = f.name;
                const active = f.id === Store.currentFolder;
                btn.style.cssText = `
                    padding:5px 12px; border-radius:6px; border:none; white-space:nowrap; cursor:pointer; font-size:12px; transition:0.15s;
                    background:${active ? '#3b82f6' : (dark ? '#2a2a3a' : '#f3f4f6')};
                    color:${active ? 'white' : (dark ? '#e0e0e0' : '#111827')}; font-weight:${active ? '600' : '400'};
                `;
                btn.onclick = () => { Store.currentFolder = f.id; App.refresh(); };
                wrap.appendChild(btn);

                if (!f.isDefault) {
                    const del = document.createElement('span');
                    del.textContent = '✕';
                    del.style.cssText = `position:absolute; right:-4px; top:-4px; width:14px; height:14px; border-radius:50%; background:#ef4444; color:white; font-size:8px; display:none; align-items:center; justify-content:center; cursor:pointer; line-height:1; box-shadow:0 1px 2px rgba(0,0,0,0.2);`;
                    wrap.onmouseenter = () => del.style.display = 'flex';
                    wrap.onmouseleave = () => del.style.display = 'none';
                    del.onclick = (e) => { e.stopPropagation(); if (confirm(`删除「${f.name}」？`)) { Store.deleteFolder(f.id); App.refresh(); } };
                    wrap.appendChild(del);
                }
                box.appendChild(wrap);
            });
        },
        setupHover() {
            if (document.getElementById('ds-hover-btn')) return;
            const btn = document.createElement('div');
            btn.id = 'ds-hover-btn';
            btn.textContent = '📂';
            btn.style.cssText = `position:fixed; z-index:99998; cursor:pointer; font-size:15px; display:none; padding:2px 5px; border-radius:4px; background:rgba(59,130,246,0.2); line-height:1.2; user-select:none; transition:0.15s;`;
            document.body.appendChild(btn);

            let hoverId = null, timer = null;
            const hide = () => timer = setTimeout(() => { btn.style.display = 'none'; hoverId = null; }, 300);
            const cancel = () => clearTimeout(timer);

            btn.onmouseenter = () => { cancel(); btn.style.background = 'rgba(59,130,246,0.5)'; };
            btn.onmouseleave = () => { btn.style.background = 'rgba(59,130,246,0.2)'; hide(); };
            btn.onclick = (e) => { e.stopPropagation(); e.preventDefault(); if (hoverId) this.showMenu(btn.getBoundingClientRect(), hoverId); btn.style.display = 'none'; };

            document.addEventListener('mouseover', (e) => {
                if (App.isBatchMode || e.target.closest('#ds-hover-btn')) return cancel();
                const link = e.target.closest('a[href*="/chat/"]');
                const id = link ? DOM.extractId(link) : null;
                if (!id) return hide();
                
                cancel(); hoverId = id;
                const rect = link.getBoundingClientRect();
                btn.style.display = 'block';
                btn.style.left = `${rect.left + 4}px`;
                btn.style.top = `${rect.top + (rect.height - 20) / 2}px`;
            });
            document.addEventListener('contextmenu', (e) => {
                if (App.isBatchMode) return;
                const link = e.target.closest('a[href*="/chat/"]');
                const id = link ? DOM.extractId(link) : null;
                if (id) { e.preventDefault(); this.showMenu({ left: e.clientX, bottom: e.clientY - 4 }, id); }
            });
        },
        showMenu(rect, chatIds) {
            document.querySelector('.ds-ctx-menu')?.remove();
            const dark = DOM.isDark();
            const menu = document.createElement('div');
            menu.className = 'ds-ctx-menu';
            menu.style.cssText = `position:fixed; z-index:99999; background:${dark ? '#252535' : 'white'}; border:1px solid ${dark ? '#3a3a4a' : '#ddd'}; border-radius:8px; padding:6px 0; box-shadow:0 4px 16px rgba(0,0,0,0.2); min-width:180px; color:${dark ? '#f0f0f0' : '#111'}; font-family:sans-serif;`;

            const isMulti = Array.isArray(chatIds);
            const curFolder = isMulti ? null : (Store.map[chatIds] || 'default');

            Store.folders.forEach(f => {
                const isCur = !isMulti && f.id === curFolder;
                const item = document.createElement('div');
                item.textContent = `${isCur ? '✅ ' : '📂 '}${f.name}`;
                item.style.cssText = `padding:8px 14px; cursor:${isCur ? 'default' : 'pointer'}; font-size:13px; opacity:${isCur ? '0.5' : '1'};`;
                if (!isCur) {
                    item.onmouseenter = () => item.style.background = dark ? '#3a3a4a' : '#f3f4f6';
                    item.onmouseleave = () => item.style.background = 'transparent';
                    item.onclick = () => { 
                        Store.moveChats(chatIds, f.id); 
                        if (isMulti) App.toggleBatchMode(false); 
                        App.refresh(); 
                        menu.remove(); 
                    };
                }
                menu.appendChild(item);
            });

            if (isMulti || curFolder !== 'default') {
                const sep = document.createElement('div');
                sep.style.cssText = `height:1px; background:${dark ? '#3a3a4a' : '#e5e7eb'}; margin:4px 0;`;
                menu.appendChild(sep);
                const rm = document.createElement('div');
                rm.textContent = '↩️ 移出文件夹';
                rm.style.cssText = `padding:8px 14px; cursor:pointer; font-size:13px; color:#ef4444;`;
                rm.onmouseenter = () => rm.style.background = dark ? '#3a3a4a' : '#fef2f2';
                rm.onmouseleave = () => rm.style.background = 'transparent';
                rm.onclick = () => { 
                    Store.moveChats(chatIds, 'default'); 
                    if (isMulti) App.toggleBatchMode(false);
                    App.refresh(); 
                    menu.remove(); 
                };
                menu.appendChild(rm);
            }

            document.body.appendChild(menu);
            const mRect = menu.getBoundingClientRect();
            menu.style.left = `${Math.min(rect.left, window.innerWidth - mRect.width - 8)}px`;
            menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - mRect.height - 8)}px`;

            setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 50);
            window.addEventListener('scroll', () => menu.remove(), { once: true, capture: true });
        }
    };

    // ==========================================
    // 4. 核心调度中心 (Application)
    // ==========================================
    const App = {
        filterFrame: null,
        observer: null,
        isBatchMode: false,
        selectedIds: new Set(),

        start() {
            Store.init();
            UI.setupHover();
            this.bindEvents();
            setInterval(() => this.watchdog(), 1000);
            this.watchdog();
        },

        // --- 多选业务逻辑 ---
        toggleBatchMode(enable) {
            this.isBatchMode = enable;
            this.selectedIds.clear();
            
            // 💡 沉浸式多选：开启时隐藏常规按钮和导入导出按钮，腾出空间
            document.getElementById('ds-normal-btns').style.display = enable ? 'none' : 'flex';
            document.getElementById('ds-io-btns').style.display = enable ? 'none' : 'flex';
            document.getElementById('ds-batch-btns').style.display = enable ? 'flex' : 'none';
            
            this.refreshBatchUI();
        },
        toggleSelect(id) {
            if (this.selectedIds.has(id)) this.selectedIds.delete(id);
            else this.selectedIds.add(id);
            this.refreshBatchUI();
        },
        refreshBatchUI() {
            const moveBtn = document.getElementById('ds-batch-move');
            if (moveBtn) moveBtn.textContent = `📂 移动已选 (${this.selectedIds.size})`;
            DOM.getChats().forEach(link => {
                const row = DOM.getRow(link);
                if (row) {
                    if (this.isBatchMode && this.selectedIds.has(DOM.extractId(link))) row.classList.add('ds-selected-row');
                    else row.classList.remove('ds-selected-row');
                }
            });
        },

        // --- 核心调度与防抖 ---
        scheduleFilter() {
            if (this.filterFrame) return;
            this.filterFrame = requestAnimationFrame(() => {
                this.executeFilter();
                this.filterFrame = null;
            });
        },
        refresh() {
            UI.renderTabs();
            this.scheduleFilter();
        },
        executeFilter() {
            if (!DOM.container) return;
            const chats = DOM.getChats();
            const { currentFolder, map } = Store;

            chats.forEach(link => {
                const id = DOM.extractId(link);
                if (!id) return;
                const row = DOM.getRow(link);
                if (row) row.style.setProperty('display', (currentFolder === 'default' || (map[id] || 'default') === currentFolder) ? '' : 'none', 'important');
            });
            this.processDateTitles(chats);
            this.refreshBatchUI();
        },
        processDateTitles(chats) {
            const dateRegex = /^(今天|昨天|前天|过去\d+天|\d{1,2}月\d{0,2}日?|\d{4}年?\s*\d{0,2}月?\s*\d{0,2}日?|\d+天前|更早|本周|本月|上月|上周|\d{1,2}月)$/;
            const titles =[];
            const walker = document.createTreeWalker(DOM.container, NodeFilter.SHOW_TEXT, null);
            while (walker.nextNode()) {
                const text = walker.currentNode.nodeValue.trim();
                if (text && text.length <= 15 && dateRegex.test(text)) {
                    const parent = walker.currentNode.parentElement;
                    if (parent && !parent.querySelector('a[href*="/chat/"]')) titles.push(parent);
                }
            }
            if (!titles.length) return;

            const all = [...titles.map(el => ({ type: 'title', el })), ...chats.map(el => ({ type: 'chat', el }))]
                        .sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);

            let curTitle = null, hasVisible = false;
            all.forEach(item => {
                if (item.type === 'title') {
                    if (curTitle) curTitle.style.setProperty('display', hasVisible ? '' : 'none', 'important');
                    curTitle = item.el; hasVisible = false;
                } else if (item.type === 'chat' && curTitle) {
                    const row = DOM.getRow(item.el);
                    if (row && row.style.display !== 'none') hasVisible = true;
                }
            });
            if (curTitle) curTitle.style.setProperty('display', hasVisible ? '' : 'none', 'important');
        },

        bindEvents() {
            this.observer = new MutationObserver(mutations => {
                if (mutations.some(m => m.addedNodes.length > 0)) this.scheduleFilter();
            });

            document.addEventListener('click', (e) => {
                if (!this.isBatchMode) return;
                const link = e.target.closest('a[href*="/chat/"]');
                if (link) {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = DOM.extractId(link);
                    if (id) this.toggleSelect(id);
                }
            }, true);
        },

        watchdog() {
            const container = DOM.findContainer();
            if (!container) return;
            
            let needRebind = false;
            if (DOM.container !== container) {
                DOM.container = container;
                this.observer.disconnect();
                this.observer.observe(container, { childList: true, subtree: true });
                needRebind = true;
            }
            if (!document.getElementById('ds-folder-toolbar')) {
                UI.injectToolbar(container);
                needRebind = true;
            }
            if (needRebind) this.scheduleFilter();
        },

        // --- 导入导出工具 ---
        exportData() {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([JSON.stringify({ folders: Store.folders, map: Store.map }, null, 2)], { type: 'application/json' }));
            a.download = `DS_Folders_${new Date().toISOString().split('T')[0]}.json`;
            a.click(); URL.revokeObjectURL(a.href);
        },
        importData() {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '.json';
            input.onchange = e => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => {
                    try {
                        const data = JSON.parse(ev.target.result);
                        if (data.folders && data.map) { Store.folders = data.folders; Store.map = data.map; Store.save(); alert('✅ 导入成功！'); location.reload(); }
                        else throw new Error();
                    } catch (err) { alert('❌ 导入失败，文件格式错误！'); }
                };
                reader.readAsText(file);
            };
            input.click();
        }
    };

    // 启动探针
    let attempts = setInterval(() => {
        if (document.querySelector('a[href*="/chat/"]')) {
            clearInterval(attempts);
            App.start();
        }
    }, 500);

})();