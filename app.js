// Family Grocery List App
// Collaborative grocery list with smart features

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const state = {
    currentUser: null,
    currentList: null,
    items: [],
    frequentItems: [],
    archivedLists: [],
    settings: {
        autoAddFrequent: true,
        groupByCategory: false
    }
};

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const elements = {
    // Sections
    currentListSection: document.getElementById('current-list-section'),
    archivedListsSection: document.getElementById('archived-lists-section'),

    // List elements
    listTitle: document.getElementById('list-title'),
    itemsList: document.getElementById('items-list'),
    listStats: document.getElementById('list-stats'),
    totalItems: document.getElementById('total-items'),
    checkedItems: document.getElementById('checked-items'),

    // Frequent items
    frequentItemsSection: document.getElementById('frequent-items-section'),
    frequentItemsList: document.getElementById('frequent-items-list'),

    // Input fields
    itemInput: document.getElementById('item-input'),
    quantityInput: document.getElementById('quantity-input'),
    categoryInput: document.getElementById('category-input'),
    addItemBtn: document.getElementById('add-item-btn'),

    // Buttons
    newListBtn: document.getElementById('new-list-btn'),
    archiveListBtn: document.getElementById('archive-list-btn'),
    settingsBtn: document.getElementById('settings-btn'),
    viewHistoryBtn: document.getElementById('view-history-btn'),
    closeHistoryBtn: document.getElementById('close-history-btn'),
    clearFrequentBtn: document.getElementById('clear-frequent-btn'),

    // Modals
    settingsModal: document.getElementById('settings-modal'),
    closeSettingsBtn: document.getElementById('close-settings-btn'),
    authModal: document.getElementById('auth-modal'),

    // Settings
    autoAddFrequentCheckbox: document.getElementById('auto-add-frequent'),
    groupByCategoryCheckbox: document.getElementById('group-by-category'),
    shareLink: document.getElementById('share-link'),
    copyLinkBtn: document.getElementById('copy-link-btn'),

    // Auth
    userProfile: document.getElementById('user-profile'),
    userMenuBtn: document.getElementById('user-menu-btn'),
    userMenu: document.getElementById('user-menu'),
    userEmail: document.getElementById('user-email'),
    signOutBtn: document.getElementById('sign-out-btn'),
    skipAuthBtn: document.getElementById('skip-auth-btn'),
    signInTab: document.getElementById('sign-in-tab'),
    signUpTab: document.getElementById('sign-up-tab'),
    authForm: document.getElementById('auth-form'),
    authSubmitBtn: document.getElementById('auth-submit-btn'),
    emailInput: document.getElementById('email'),
    passwordInput: document.getElementById('password'),
    errorMessage: document.getElementById('error-message'),

    // Archived lists
    archivedLists: document.getElementById('archived-lists')
};

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
    console.log('Initializing Grocery List App...');

    // Set up event listeners
    setupEventListeners();

    // Load settings from localStorage
    loadSettings();

    // Set share link
    elements.shareLink.value = window.location.href;

    // Check authentication state
    if (window.supabase) {
        const { data: { session } } = await window.supabase.auth.getSession();
        if (session) {
            handleAuthStateChange(session);
            elements.authModal.classList.add('hidden');
        } else {
            // Show auth modal
            const skipAuth = localStorage.getItem('skipAuth');
            if (skipAuth === 'true') {
                elements.authModal.classList.add('hidden');
                await loadFromLocalStorage();
            } else {
                elements.authModal.classList.remove('hidden');
            }
        }

        // Listen for auth changes
        window.supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN') {
                handleAuthStateChange(session);
                elements.authModal.classList.add('hidden');
            } else if (event === 'SIGNED_OUT') {
                handleSignOut();
            }
        });
    } else {
        // No Supabase, use localStorage only
        console.log('Running in offline mode');
        elements.authModal.classList.add('hidden');
        await loadFromLocalStorage();
    }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
    // Add item
    elements.addItemBtn.addEventListener('click', addItem);
    elements.itemInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addItem();
    });

    // List actions
    elements.newListBtn.addEventListener('click', startNewList);
    elements.archiveListBtn.addEventListener('click', archiveCurrentList);

    // Settings
    elements.settingsBtn.addEventListener('click', () => {
        elements.settingsModal.classList.remove('hidden');
    });
    elements.closeSettingsBtn.addEventListener('click', () => {
        elements.settingsModal.classList.add('hidden');
    });
    elements.viewHistoryBtn.addEventListener('click', showArchivedLists);
    elements.closeHistoryBtn.addEventListener('click', () => {
        elements.archivedListsSection.classList.add('hidden');
        elements.currentListSection.classList.remove('hidden');
    });
    elements.clearFrequentBtn.addEventListener('click', clearFrequentItems);

    // Settings checkboxes
    elements.autoAddFrequentCheckbox.addEventListener('change', (e) => {
        state.settings.autoAddFrequent = e.target.checked;
        saveSettings();
    });
    elements.groupByCategoryCheckbox.addEventListener('change', (e) => {
        state.settings.groupByCategory = e.target.checked;
        saveSettings();
        renderItems();
    });

    // Share link
    elements.copyLinkBtn.addEventListener('click', () => {
        elements.shareLink.select();
        document.execCommand('copy');
        elements.copyLinkBtn.textContent = '✓ Copied!';
        setTimeout(() => {
            elements.copyLinkBtn.textContent = '📋 Copy';
        }, 2000);
    });

    // Auth
    elements.userMenuBtn?.addEventListener('click', () => {
        elements.userMenu.classList.toggle('hidden');
    });
    elements.signOutBtn?.addEventListener('click', signOut);
    elements.skipAuthBtn?.addEventListener('click', () => {
        localStorage.setItem('skipAuth', 'true');
        elements.authModal.classList.add('hidden');
        loadFromLocalStorage();
    });

    // Auth tabs
    elements.signInTab?.addEventListener('click', () => {
        elements.signInTab.classList.add('active');
        elements.signUpTab.classList.remove('active');
        elements.authSubmitBtn.textContent = 'Sign In';
    });
    elements.signUpTab?.addEventListener('click', () => {
        elements.signUpTab.classList.add('active');
        elements.signInTab.classList.remove('active');
        elements.authSubmitBtn.textContent = 'Sign Up';
    });

    // Auth form
    elements.authForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = elements.emailInput.value;
        const password = elements.passwordInput.value;
        const isSignUp = elements.signUpTab.classList.contains('active');

        try {
            if (isSignUp) {
                await signUp(email, password);
            } else {
                await signIn(email, password);
            }
        } catch (error) {
            showError(error.message);
        }
    });

    // Click outside to close modals
    window.addEventListener('click', (e) => {
        if (e.target === elements.settingsModal) {
            elements.settingsModal.classList.add('hidden');
        }
        if (!elements.userMenuBtn?.contains(e.target) && !elements.userMenu?.contains(e.target)) {
            elements.userMenu?.classList.add('hidden');
        }
    });
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

async function signUp(email, password) {
    const { data, error } = await window.supabase.auth.signUp({
        email,
        password
    });

    if (error) throw error;

    // Show success message
    showError('Check your email to confirm your account!', 'success');
}

async function signIn(email, password) {
    const { data, error } = await window.supabase.auth.signInWithPassword({
        email,
        password
    });

    if (error) throw error;
}

async function signOut() {
    await window.supabase.auth.signOut();
}

function handleAuthStateChange(session) {
    state.currentUser = session.user;
    elements.userProfile.classList.remove('hidden');
    elements.userEmail.textContent = session.user.email;

    // Load data from database
    loadFromDatabase();
}

function handleSignOut() {
    state.currentUser = null;
    elements.userProfile.classList.add('hidden');

    // Clear state and reload from localStorage
    state.currentList = null;
    state.items = [];
    state.frequentItems = [];
    state.archivedLists = [];

    loadFromLocalStorage();
}

function showError(message, type = 'error') {
    elements.errorMessage.textContent = message;
    elements.errorMessage.classList.remove('hidden');
    elements.errorMessage.style.color = type === 'success' ? '#4A7C59' : '#C74B50';

    setTimeout(() => {
        elements.errorMessage.classList.add('hidden');
    }, 5000);
}

// ============================================================================
// DATA PERSISTENCE
// ============================================================================

async function loadFromDatabase() {
    if (!window.supabase || !state.currentUser) {
        return loadFromLocalStorage();
    }

    try {
        // Load current list
        const { data: lists, error: listsError } = await window.supabase
            .from('grocery_lists')
            .select('*')
            .eq('user_id', state.currentUser.id)
            .eq('is_archived', false)
            .order('created_at', { ascending: false })
            .limit(1);

        if (listsError) throw listsError;

        if (lists && lists.length > 0) {
            state.currentList = lists[0];

            // Load items for current list
            const { data: items, error: itemsError } = await window.supabase
                .from('grocery_items')
                .select('*')
                .eq('list_id', state.currentList.id)
                .order('created_at', { ascending: true });

            if (itemsError) throw itemsError;

            state.items = items || [];
        } else {
            // Create a new list
            await createNewList();
        }

        // Load frequent items
        const { data: frequentItems, error: frequentError } = await window.supabase
            .from('frequent_items')
            .select('*')
            .eq('user_id', state.currentUser.id)
            .order('frequency_count', { ascending: false })
            .limit(10);

        if (frequentError) throw frequentError;

        state.frequentItems = frequentItems || [];

        // Load archived lists
        const { data: archivedLists, error: archivedError } = await window.supabase
            .from('grocery_lists')
            .select('*')
            .eq('user_id', state.currentUser.id)
            .eq('is_archived', true)
            .order('archived_at', { ascending: false })
            .limit(20);

        if (archivedError) throw archivedError;

        state.archivedLists = archivedLists || [];

        // Render UI
        renderItems();
        renderFrequentItems();
        updateListTitle();

    } catch (error) {
        console.error('Error loading from database:', error);
        // Fallback to localStorage
        loadFromLocalStorage();
    }
}

async function loadFromLocalStorage() {
    const saved = localStorage.getItem('groceryListData');
    if (saved) {
        const data = JSON.parse(saved);
        state.currentList = data.currentList || { name: 'Current List', created_at: new Date().toISOString() };
        state.items = data.items || [];
        state.frequentItems = data.frequentItems || [];
        state.archivedLists = data.archivedLists || [];
    } else {
        // Initialize new list
        state.currentList = {
            name: 'Current List',
            created_at: new Date().toISOString()
        };
        state.items = [];
        state.frequentItems = [];
        state.archivedLists = [];
    }

    renderItems();
    renderFrequentItems();
    updateListTitle();
}

async function saveToLocalStorage() {
    const data = {
        currentList: state.currentList,
        items: state.items,
        frequentItems: state.frequentItems,
        archivedLists: state.archivedLists
    };
    localStorage.setItem('groceryListData', JSON.stringify(data));
}

async function saveToDatabase() {
    if (!window.supabase || !state.currentUser) {
        return saveToLocalStorage();
    }

    // Database saves are handled individually in each action
    // This is just a fallback
    saveToLocalStorage();
}

// ============================================================================
// SETTINGS
// ============================================================================

function loadSettings() {
    const saved = localStorage.getItem('groceryListSettings');
    if (saved) {
        state.settings = JSON.parse(saved);
    }

    elements.autoAddFrequentCheckbox.checked = state.settings.autoAddFrequent;
    elements.groupByCategoryCheckbox.checked = state.settings.groupByCategory;
}

function saveSettings() {
    localStorage.setItem('groceryListSettings', JSON.stringify(state.settings));
}

// ============================================================================
// LIST MANAGEMENT
// ============================================================================

async function createNewList(autoAddFrequent = true) {
    const listName = `List - ${new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    })}`;

    const newList = {
        name: listName,
        created_at: new Date().toISOString(),
        is_archived: false
    };

    if (window.supabase && state.currentUser) {
        try {
            const { data, error } = await window.supabase
                .from('grocery_lists')
                .insert([{
                    user_id: state.currentUser.id,
                    name: listName,
                    is_archived: false
                }])
                .select()
                .single();

            if (error) throw error;

            state.currentList = data;

            // Auto-add frequent items if enabled
            if (autoAddFrequent && state.settings.autoAddFrequent && state.frequentItems.length > 0) {
                for (const item of state.frequentItems.slice(0, 5)) {
                    await addItemToDatabase({
                        name: item.name,
                        quantity: item.typical_quantity,
                        category: item.category
                    });
                }
            }

        } catch (error) {
            console.error('Error creating list in database:', error);
            // Fallback to localStorage
            state.currentList = newList;
            if (autoAddFrequent && state.settings.autoAddFrequent) {
                state.items = state.frequentItems.slice(0, 5).map(item => ({
                    id: Date.now() + Math.random(),
                    name: item.name,
                    quantity: item.typical_quantity,
                    category: item.category,
                    is_checked: false,
                    created_at: new Date().toISOString()
                }));
            }
            saveToLocalStorage();
        }
    } else {
        state.currentList = newList;
        if (autoAddFrequent && state.settings.autoAddFrequent) {
            state.items = state.frequentItems.slice(0, 5).map(item => ({
                id: Date.now() + Math.random(),
                name: item.name,
                quantity: item.typical_quantity,
                category: item.category,
                is_checked: false,
                created_at: new Date().toISOString()
            }));
        } else {
            state.items = [];
        }
        saveToLocalStorage();
    }

    updateListTitle();
    renderItems();
    renderFrequentItems();
}

async function startNewList() {
    if (state.items.length > 0) {
        if (!confirm('This will archive your current list and start a new one. Continue?')) {
            return;
        }
        await archiveCurrentList();
    }

    await createNewList(true);
}

async function archiveCurrentList() {
    if (!state.currentList || state.items.length === 0) {
        alert('Nothing to archive!');
        return;
    }

    if (window.supabase && state.currentUser && state.currentList.id) {
        try {
            // Archive the list in database
            const { error } = await window.supabase
                .from('grocery_lists')
                .update({
                    is_archived: true,
                    archived_at: new Date().toISOString()
                })
                .eq('id', state.currentList.id);

            if (error) throw error;

            // The trigger will automatically update frequent_items

            // Add to archived lists
            state.archivedLists.unshift({
                ...state.currentList,
                is_archived: true,
                archived_at: new Date().toISOString(),
                items: [...state.items]
            });

            // Reload frequent items
            await loadFromDatabase();

        } catch (error) {
            console.error('Error archiving list:', error);
            archiveListLocally();
        }
    } else {
        archiveListLocally();
    }

    // Create new list
    await createNewList(true);
}

function archiveListLocally() {
    // Update frequent items locally
    state.items.forEach(item => {
        if (item.is_checked) {
            const existingIndex = state.frequentItems.findIndex(fi => fi.name.toLowerCase() === item.name.toLowerCase());
            if (existingIndex >= 0) {
                state.frequentItems[existingIndex].frequency_count++;
                state.frequentItems[existingIndex].last_purchased = new Date().toISOString();
                if (item.quantity) {
                    state.frequentItems[existingIndex].typical_quantity = item.quantity;
                }
            } else {
                state.frequentItems.push({
                    name: item.name,
                    category: item.category,
                    frequency_count: 1,
                    last_purchased: new Date().toISOString(),
                    typical_quantity: item.quantity
                });
            }
        }
    });

    // Sort by frequency
    state.frequentItems.sort((a, b) => b.frequency_count - a.frequency_count);

    // Add to archived lists
    state.archivedLists.unshift({
        ...state.currentList,
        is_archived: true,
        archived_at: new Date().toISOString(),
        items: [...state.items]
    });

    // Keep only last 20 archived lists
    state.archivedLists = state.archivedLists.slice(0, 20);

    saveToLocalStorage();
}

// ============================================================================
// ITEM MANAGEMENT
// ============================================================================

async function addItem() {
    const name = elements.itemInput.value.trim();
    if (!name) return;

    const quantity = elements.quantityInput.value.trim();
    const category = elements.categoryInput.value;

    const newItem = {
        name,
        quantity,
        category,
        is_checked: false,
        created_at: new Date().toISOString()
    };

    if (window.supabase && state.currentUser && state.currentList?.id) {
        await addItemToDatabase(newItem);
    } else {
        newItem.id = Date.now() + Math.random();
        state.items.push(newItem);
        saveToLocalStorage();
        renderItems();
    }

    // Clear inputs
    elements.itemInput.value = '';
    elements.quantityInput.value = '';
    elements.categoryInput.value = '';
    elements.itemInput.focus();
}

async function addItemToDatabase(item) {
    try {
        const { data, error } = await window.supabase
            .from('grocery_items')
            .insert([{
                list_id: state.currentList.id,
                name: item.name,
                quantity: item.quantity,
                category: item.category,
                added_by: state.currentUser.id,
                is_checked: false
            }])
            .select()
            .single();

        if (error) throw error;

        state.items.push(data);
        renderItems();

    } catch (error) {
        console.error('Error adding item to database:', error);
        // Fallback to local
        item.id = Date.now() + Math.random();
        state.items.push(item);
        saveToLocalStorage();
        renderItems();
    }
}

async function toggleItem(itemId) {
    const item = state.items.find(i => i.id === itemId);
    if (!item) return;

    item.is_checked = !item.is_checked;
    item.checked_at = item.is_checked ? new Date().toISOString() : null;

    if (window.supabase && state.currentUser && state.currentList?.id) {
        try {
            const { error } = await window.supabase
                .from('grocery_items')
                .update({
                    is_checked: item.is_checked,
                    checked_at: item.checked_at
                })
                .eq('id', itemId);

            if (error) throw error;
        } catch (error) {
            console.error('Error updating item:', error);
            saveToLocalStorage();
        }
    } else {
        saveToLocalStorage();
    }

    renderItems();
}

async function deleteItem(itemId) {
    if (window.supabase && state.currentUser && state.currentList?.id) {
        try {
            const { error } = await window.supabase
                .from('grocery_items')
                .delete()
                .eq('id', itemId);

            if (error) throw error;

            state.items = state.items.filter(i => i.id !== itemId);
            renderItems();

        } catch (error) {
            console.error('Error deleting item:', error);
            state.items = state.items.filter(i => i.id !== itemId);
            saveToLocalStorage();
            renderItems();
        }
    } else {
        state.items = state.items.filter(i => i.id !== itemId);
        saveToLocalStorage();
        renderItems();
    }
}

async function addFrequentItem(itemName, category, quantity) {
    const newItem = {
        name: itemName,
        quantity: quantity,
        category: category,
        is_checked: false,
        created_at: new Date().toISOString()
    };

    if (window.supabase && state.currentUser && state.currentList?.id) {
        await addItemToDatabase(newItem);
    } else {
        newItem.id = Date.now() + Math.random();
        state.items.push(newItem);
        saveToLocalStorage();
        renderItems();
    }
}

async function clearFrequentItems() {
    if (!confirm('This will clear all frequent items. Continue?')) {
        return;
    }

    if (window.supabase && state.currentUser) {
        try {
            const { error } = await window.supabase
                .from('frequent_items')
                .delete()
                .eq('user_id', state.currentUser.id);

            if (error) throw error;

            state.frequentItems = [];
            renderFrequentItems();

        } catch (error) {
            console.error('Error clearing frequent items:', error);
            state.frequentItems = [];
            saveToLocalStorage();
            renderFrequentItems();
        }
    } else {
        state.frequentItems = [];
        saveToLocalStorage();
        renderFrequentItems();
    }
}

// ============================================================================
// UI RENDERING
// ============================================================================

function updateListTitle() {
    if (state.currentList) {
        elements.listTitle.textContent = state.currentList.name;
    }
}

function renderItems() {
    if (state.items.length === 0) {
        elements.itemsList.innerHTML = '<p class="empty-state">Your list is empty. Add some items to get started!</p>';
        elements.listStats.classList.add('hidden');
        return;
    }

    let itemsToRender = [...state.items];

    // Group by category if enabled
    if (state.settings.groupByCategory) {
        const categories = {
            'produce': [],
            'dairy': [],
            'meat': [],
            'bakery': [],
            'pantry': [],
            'frozen': [],
            'beverages': [],
            'snacks': [],
            'household': [],
            'other': []
        };

        itemsToRender.forEach(item => {
            const cat = item.category || 'other';
            if (categories[cat]) {
                categories[cat].push(item);
            } else {
                categories.other.push(item);
            }
        });

        let html = '';
        Object.entries(categories).forEach(([category, items]) => {
            if (items.length > 0) {
                const categoryEmoji = {
                    'produce': '🥬',
                    'dairy': '🥛',
                    'meat': '🥩',
                    'bakery': '🍞',
                    'pantry': '🥫',
                    'frozen': '❄️',
                    'beverages': '🥤',
                    'snacks': '🍿',
                    'household': '🧼',
                    'other': '📦'
                };

                html += `<div class="category-group">
                    <h3 class="category-title">${categoryEmoji[category]} ${category.charAt(0).toUpperCase() + category.slice(1)}</h3>
                    ${items.map(renderItemHTML).join('')}
                </div>`;
            }
        });

        elements.itemsList.innerHTML = html;
    } else {
        elements.itemsList.innerHTML = itemsToRender.map(renderItemHTML).join('');
    }

    // Update stats
    const total = state.items.length;
    const checked = state.items.filter(i => i.is_checked).length;
    elements.totalItems.textContent = `${total} item${total !== 1 ? 's' : ''}`;
    elements.checkedItems.textContent = `${checked} checked`;
    elements.listStats.classList.remove('hidden');

    // Add event listeners to checkboxes and delete buttons
    document.querySelectorAll('.item-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const itemId = e.target.dataset.itemId;
            toggleItem(itemId);
        });
    });

    document.querySelectorAll('.delete-item-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const itemId = e.target.dataset.itemId;
            deleteItem(itemId);
        });
    });
}

function renderItemHTML(item) {
    return `
        <div class="item ${item.is_checked ? 'checked' : ''}">
            <label class="item-label">
                <input type="checkbox"
                       class="item-checkbox"
                       data-item-id="${item.id}"
                       ${item.is_checked ? 'checked' : ''}>
                <span class="item-name">${escapeHtml(item.name)}</span>
                ${item.quantity ? `<span class="item-quantity">${escapeHtml(item.quantity)}</span>` : ''}
            </label>
            <button class="delete-item-btn" data-item-id="${item.id}" title="Delete">🗑️</button>
        </div>
    `;
}

function renderFrequentItems() {
    if (state.frequentItems.length === 0) {
        elements.frequentItemsSection.classList.add('hidden');
        return;
    }

    elements.frequentItemsSection.classList.remove('hidden');

    const html = state.frequentItems.slice(0, 10).map(item => `
        <button class="frequent-item-btn"
                data-name="${escapeHtml(item.name)}"
                data-category="${item.category || ''}"
                data-quantity="${item.typical_quantity || ''}">
            ${escapeHtml(item.name)}
            ${item.frequency_count > 1 ? `<span class="frequency-badge">${item.frequency_count}×</span>` : ''}
        </button>
    `).join('');

    elements.frequentItemsList.innerHTML = html;

    // Add event listeners
    document.querySelectorAll('.frequent-item-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const name = e.target.dataset.name;
            const category = e.target.dataset.category;
            const quantity = e.target.dataset.quantity;
            addFrequentItem(name, category, quantity);
        });
    });
}

async function showArchivedLists() {
    if (window.supabase && state.currentUser) {
        // Reload from database
        try {
            const { data, error } = await window.supabase
                .from('grocery_lists')
                .select('*, grocery_items(*)')
                .eq('user_id', state.currentUser.id)
                .eq('is_archived', true)
                .order('archived_at', { ascending: false })
                .limit(20);

            if (error) throw error;

            state.archivedLists = data.map(list => ({
                ...list,
                items: list.grocery_items || []
            }));

        } catch (error) {
            console.error('Error loading archived lists:', error);
        }
    }

    if (state.archivedLists.length === 0) {
        alert('No archived lists yet!');
        return;
    }

    const html = state.archivedLists.map(list => {
        const date = new Date(list.archived_at || list.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });

        const itemCount = list.items?.length || 0;
        const checkedCount = list.items?.filter(i => i.is_checked).length || 0;

        return `
            <div class="archived-list-card">
                <h3>${escapeHtml(list.name)}</h3>
                <p class="list-date">📅 ${date}</p>
                <p class="list-stats">${itemCount} items (${checkedCount} purchased)</p>
                <div class="archived-items">
                    ${(list.items || []).map(item => `
                        <span class="archived-item ${item.is_checked ? 'checked' : ''}">
                            ${escapeHtml(item.name)}
                            ${item.quantity ? `<span class="qty">${escapeHtml(item.quantity)}</span>` : ''}
                        </span>
                    `).join('')}
                </div>
            </div>
        `;
    }).join('');

    elements.archivedLists.innerHTML = html;
    elements.currentListSection.classList.add('hidden');
    elements.archivedListsSection.classList.remove('hidden');
}

// ============================================================================
// UTILITIES
// ============================================================================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// START APP
// ============================================================================

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Export for debugging
window.groceryApp = {
    state,
    addItem,
    toggleItem,
    deleteItem,
    startNewList,
    archiveCurrentList
};
