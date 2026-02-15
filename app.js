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
    familyMembers: [],
    familyGroupId: null,
    categoryOverrides: {},  // { lowercase_item_name: category }
    settings: {
        autoAddFrequent: true,
        groupByCategory: false
    },
    realtimeSubscription: null,
    skylightSyncInProgress: false
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
    editTitleBtn: document.getElementById('edit-title-btn'),
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

    // Recent lists
    recentListsDropdown: document.getElementById('recent-lists-dropdown'),
    duplicateListBtn: document.getElementById('duplicate-list-btn'),
    addCommonBtn: document.getElementById('add-common-btn'),

    // Buttons
    newListBtn: document.getElementById('new-list-btn'),
    archiveListBtn: document.getElementById('archive-list-btn'),
    settingsBtn: document.getElementById('settings-btn'),
    viewHistoryBtn: document.getElementById('view-history-btn'),
    closeHistoryBtn: document.getElementById('close-history-btn'),
    clearFrequentBtn: document.getElementById('clear-frequent-btn'),
    syncFromSkylightBtn: document.getElementById('sync-from-skylight-btn'),
    skylightSyncStatus: document.getElementById('skylight-sync-status'),

    // Modals
    settingsModal: document.getElementById('settings-modal'),
    closeSettingsBtn: document.getElementById('close-settings-btn'),
    authModal: document.getElementById('auth-modal'),
    editModal: document.getElementById('edit-modal'),
    closeEditBtn: document.getElementById('close-edit-btn'),
    editItemName: document.getElementById('edit-item-name'),
    editItemQuantity: document.getElementById('edit-item-quantity'),
    editItemCategory: document.getElementById('edit-item-category'),
    editItemNotes: document.getElementById('edit-item-notes'),
    saveEditBtn: document.getElementById('save-edit-btn'),

    // Family invite
    inviteEmail: document.getElementById('invite-email'),
    sendInviteBtn: document.getElementById('send-invite-btn'),
    familyMembersList: document.getElementById('family-members-list'),
    inviteModal: document.getElementById('invite-modal'),
    closeInviteBtn: document.getElementById('close-invite-btn'),
    inviteMessage: document.getElementById('invite-message'),
    acceptInviteBtn: document.getElementById('accept-invite-btn'),
    declineInviteBtn: document.getElementById('decline-invite-btn'),

    // SMS / Phone
    phoneNumberInput: document.getElementById('phone-number-input'),
    savePhoneBtn: document.getElementById('save-phone-btn'),
    phoneStatus: document.getElementById('phone-status'),
    smsInstructions: document.getElementById('sms-instructions'),
    smsNumber: document.getElementById('sms-number'),

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
    archivedLists: document.getElementById('archived-lists'),

    // Toast container
    toastContainer: document.getElementById('toast-container')
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

    // Register service worker
    registerServiceWorker();

    // Check for invite token in URL
    checkForInvite();

    // Check authentication state
    if (window.supabase) {
        const { data: { session } } = await window.supabase.auth.getSession();
        if (session) {
            handleAuthStateChange(session);
            elements.authModal.classList.add('hidden');
        } else {
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

        // Start hourly Skylight sync (8am–10pm)
        setupScheduledSync();
    } else {
        // No Supabase, use localStorage only
        console.log('Running in offline mode');
        elements.authModal.classList.add('hidden');
        await loadFromLocalStorage();
    }
}

// ============================================================================
// SERVICE WORKER
// ============================================================================

async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('sw.js');
            console.log('Service Worker registered:', registration.scope);
        } catch (error) {
            console.log('Service Worker registration failed:', error);
        }
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

    // Live auto-suggest category as user types
    elements.itemInput.addEventListener('input', (e) => {
        const itemName = e.target.value.trim();
        if (itemName && !elements.categoryInput.value) {
            const suggestedCategory = autoCategorize(itemName);
            if (suggestedCategory) {
                elements.categoryInput.value = suggestedCategory;
                elements.categoryInput.style.fontStyle = 'italic';
            }
        }
    });

    // Reset font style when user manually changes category
    elements.categoryInput.addEventListener('change', () => {
        elements.categoryInput.style.fontStyle = 'normal';
    });

    // List actions
    elements.newListBtn.addEventListener('click', startNewList);
    elements.archiveListBtn.addEventListener('click', archiveCurrentList);
    elements.duplicateListBtn.addEventListener('click', duplicateSelectedList);
    elements.editTitleBtn.addEventListener('click', startEditingTitle);
    elements.listTitle.addEventListener('click', startEditingTitle);
    elements.addCommonBtn.addEventListener('click', addCommonItems);

    // Settings
    elements.settingsBtn.addEventListener('click', () => {
        elements.settingsModal.classList.remove('hidden');
    });
    elements.closeSettingsBtn.addEventListener('click', () => {
        elements.settingsModal.classList.add('hidden');
    });

    // Edit modal
    elements.closeEditBtn?.addEventListener('click', closeEditModal);
    elements.saveEditBtn?.addEventListener('click', saveEditedItem);
    elements.viewHistoryBtn.addEventListener('click', showArchivedLists);
    elements.closeHistoryBtn.addEventListener('click', () => {
        elements.archivedListsSection.classList.add('hidden');
        elements.currentListSection.classList.remove('hidden');
    });
    elements.clearFrequentBtn.addEventListener('click', clearFrequentItems);
    elements.syncFromSkylightBtn?.addEventListener('click', syncFromSkylight);

    // SMS phone registration
    elements.savePhoneBtn?.addEventListener('click', savePhoneNumber);

    // Family invite
    elements.sendInviteBtn?.addEventListener('click', sendFamilyInvite);
    elements.closeInviteBtn?.addEventListener('click', () => {
        elements.inviteModal.classList.add('hidden');
    });
    elements.acceptInviteBtn?.addEventListener('click', acceptInvite);
    elements.declineInviteBtn?.addEventListener('click', () => {
        elements.inviteModal.classList.add('hidden');
        showToast('Invitation declined', 'info');
    });

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
        if (navigator.clipboard) {
            navigator.clipboard.writeText(elements.shareLink.value).then(() => {
                showToast('Link copied!', 'success');
            });
        } else {
            elements.shareLink.select();
            document.execCommand('copy');
            showToast('Link copied!', 'success');
        }
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
                // Hide modal immediately on successful sign-in
                elements.authModal.classList.add('hidden');
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
        if (e.target === elements.editModal) {
            closeEditModal();
        }
        if (e.target === elements.inviteModal) {
            elements.inviteModal.classList.add('hidden');
        }
        if (!elements.userMenuBtn?.contains(e.target) && !elements.userMenu?.contains(e.target)) {
            elements.userMenu?.classList.add('hidden');
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            elements.settingsModal.classList.add('hidden');
            elements.inviteModal.classList.add('hidden');
            closeEditModal();
        }
    });

    // Event delegation for dynamic item buttons
    elements.itemsList.addEventListener('click', handleItemClick);
    elements.itemsList.addEventListener('change', handleItemChange);
    elements.itemsList.addEventListener('keypress', handleItemKeypress);

    // Online/offline detection
    window.addEventListener('online', () => {
        showToast('Back online', 'success');
        if (state.currentUser) {
            loadFromDatabase();
        }
    });
    window.addEventListener('offline', () => {
        showToast('You are offline. Changes will sync when reconnected.', 'warning');
    });
}

// ============================================================================
// EVENT DELEGATION FOR ITEMS
// ============================================================================

function handleItemClick(e) {
    const target = e.target.closest('button');
    if (!target) return;

    const itemId = target.dataset.itemId;
    if (!itemId) return;

    if (target.classList.contains('delete-item-btn')) {
        e.preventDefault();
        e.stopPropagation();
        deleteItem(itemId);
    } else if (target.classList.contains('edit-item-btn')) {
        e.preventDefault();
        e.stopPropagation();
        openEditModal(itemId);
    } else if (target.classList.contains('save-notes-btn')) {
        e.preventDefault();
        e.stopPropagation();
        saveInlineNotes(itemId);
    }
}

function handleItemChange(e) {
    if (e.target.classList.contains('item-checkbox')) {
        toggleItem(e.target.dataset.itemId);
    }
}

function handleItemKeypress(e) {
    if (e.key === 'Enter' && e.target.classList.contains('item-notes-input')) {
        const itemId = e.target.dataset.itemId;
        if (itemId) saveInlineNotes(itemId);
    }
}

// ============================================================================
// TOAST NOTIFICATIONS
// ============================================================================

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    elements.toastContainer.appendChild(toast);

    // Remove after animation
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 3000);
}

function showDuplicateWarning(itemName) {
    // Remove any existing duplicate warning
    const existing = document.querySelector('.duplicate-warning');
    if (existing) existing.remove();

    const warning = document.createElement('div');
    warning.className = 'duplicate-warning';
    warning.innerHTML = `
        <span>"${itemName}" is already on your list</span>
        <button class="dismiss-warning-btn">Dismiss</button>
    `;
    warning.querySelector('.dismiss-warning-btn').addEventListener('click', () => {
        warning.remove();
    });

    // Insert after the add form
    const addForm = document.querySelector('.add-item-form');
    if (addForm) {
        addForm.parentNode.insertBefore(warning, addForm.nextSibling);
    }
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

async function handleAuthStateChange(session) {
    state.currentUser = session.user;
    elements.userProfile.classList.remove('hidden');
    elements.userEmail.textContent = session.user.email;

    // Load family members first so familyGroupId is available for list queries
    await loadFamilyMembers();

    // Load data from database (uses familyGroupId to find shared family lists)
    loadFromDatabase();

    // Load phone number for SMS
    loadPhoneNumber();
}

function handleSignOut() {
    state.currentUser = null;
    elements.userProfile.classList.add('hidden');

    // Unsubscribe from realtime
    if (state.realtimeSubscription) {
        state.realtimeSubscription.unsubscribe();
        state.realtimeSubscription = null;
    }

    // Clear state and reload from localStorage
    state.currentList = null;
    state.items = [];
    state.frequentItems = [];
    state.archivedLists = [];
    state.familyMembers = [];
    state.familyGroupId = null;

    loadFromLocalStorage();
    showToast('Signed out', 'info');
}

function showError(message, type = 'error') {
    elements.errorMessage.textContent = message;
    elements.errorMessage.classList.remove('hidden');
    elements.errorMessage.style.color = type === 'success' ? '#4A7C59' : '#C74B50';
    elements.errorMessage.style.background = type === 'success' ? '#e8f5e9' : '';

    setTimeout(() => {
        elements.errorMessage.classList.add('hidden');
    }, 5000);
}

// ============================================================================
// REAL-TIME SYNC
// ============================================================================

function setupRealtimeSubscription() {
    if (!window.supabase || !state.currentUser || !state.currentList?.id) return;

    // Unsubscribe from previous subscription
    if (state.realtimeSubscription) {
        state.realtimeSubscription.unsubscribe();
    }

    state.realtimeSubscription = window.supabase
        .channel('grocery-items-changes')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'grocery_items',
                filter: `list_id=eq.${state.currentList.id}`
            },
            (payload) => {
                handleRealtimeChange(payload);
            }
        )
        .subscribe();
}

function handleRealtimeChange(payload) {
    const { eventType, new: newRecord, old: oldRecord } = payload;

    switch (eventType) {
        case 'INSERT': {
            // Only add if we don't already have it (avoid duplicates from our own inserts)
            if (!state.items.find(i => i.id === newRecord.id)) {
                state.items.push(newRecord);
                renderItems();
                showToast(`${newRecord.name} added to list`, 'success');
            }
            break;
        }
        case 'UPDATE': {
            const index = state.items.findIndex(i => i.id === newRecord.id);
            if (index >= 0) {
                state.items[index] = newRecord;
                renderItems();
            }
            break;
        }
        case 'DELETE': {
            const deleteId = oldRecord?.id;
            if (deleteId) {
                state.items = state.items.filter(i => i.id !== deleteId);
                renderItems();
            }
            break;
        }
    }

    // Keep localStorage in sync
    saveToLocalStorage();
}

// ============================================================================
// DATA PERSISTENCE
// ============================================================================

async function loadFromDatabase() {
    if (!window.supabase || !state.currentUser) {
        return loadFromLocalStorage();
    }

    try {
        let foundList = null;

        if (state.familyGroupId) {
            // FAMILY MODE: All family members must converge on ONE shared list.
            // Get ALL active lists with family_id (there may be duplicates).
            // Keep the most recent one, archive the rest — so any member
            // creating a new list makes it the active list for everyone.
            const { data: familyLists, error: famErr } = await window.supabase
                .from('grocery_lists')
                .select('*')
                .eq('is_archived', false)
                .eq('family_id', state.familyGroupId)
                .order('updated_at', { ascending: false });

            if (famErr) throw famErr;

            if (familyLists && familyLists.length > 0) {
                // Use the most recent family list
                foundList = familyLists[0];

                // Archive any duplicate active family lists
                for (let i = 1; i < familyLists.length; i++) {
                    await window.supabase
                        .from('grocery_lists')
                        .update({
                            is_archived: true,
                            archived_at: new Date().toISOString()
                        })
                        .eq('id', familyLists[i].id);
                }
            }

            // Also archive any personal active lists (without family_id)
            // so everyone uses the single shared family list
            const { data: personalLists } = await window.supabase
                .from('grocery_lists')
                .select('*')
                .eq('user_id', state.currentUser.id)
                .eq('is_archived', false)
                .is('family_id', null);

            for (const personal of (personalLists || [])) {
                if (!foundList) {
                    // No family list exists yet — promote this personal list
                    await window.supabase
                        .from('grocery_lists')
                        .update({ family_id: state.familyGroupId })
                        .eq('id', personal.id);
                    personal.family_id = state.familyGroupId;
                    foundList = personal;
                } else {
                    // Family list already exists — archive this personal list
                    await window.supabase
                        .from('grocery_lists')
                        .update({
                            is_archived: true,
                            archived_at: new Date().toISOString(),
                            family_id: state.familyGroupId
                        })
                        .eq('id', personal.id);
                }
            }

            // Fallback: if still no list found, look for any family member's
            // active list (even if not yet tagged with family_id). This handles
            // the case where another member's list hasn't been migrated yet.
            if (!foundList) {
                const memberIds = state.familyMembers
                    .filter(m => m.status === 'accepted' && m.user_id)
                    .map(m => m.user_id);

                if (memberIds.length > 0) {
                    const { data: memberLists } = await window.supabase
                        .from('grocery_lists')
                        .select('*')
                        .in('user_id', memberIds)
                        .eq('is_archived', false)
                        .order('updated_at', { ascending: false })
                        .limit(1);

                    if (memberLists && memberLists.length > 0) {
                        foundList = memberLists[0];
                        // Tag it with family_id so future lookups find it directly
                        if (!foundList.family_id) {
                            await window.supabase
                                .from('grocery_lists')
                                .update({ family_id: state.familyGroupId })
                                .eq('id', foundList.id);
                            foundList.family_id = state.familyGroupId;
                        }
                    }
                }
            }
        } else {
            // SOLO MODE: Just get the user's own active list
            const { data: lists, error: listsError } = await window.supabase
                .from('grocery_lists')
                .select('*')
                .eq('is_archived', false)
                .eq('user_id', state.currentUser.id)
                .order('updated_at', { ascending: false })
                .limit(1);

            if (listsError) throw listsError;

            if (lists && lists.length > 0) {
                foundList = lists[0];
            }
        }

        // Last-resort fallback: if no list was found through family or solo
        // queries, look for ANY active list owned by this user regardless of
        // family_id. This prevents losing a list when family_id tagging is
        // inconsistent or the user's family membership state changes.
        if (!foundList) {
            const { data: anyActive } = await window.supabase
                .from('grocery_lists')
                .select('*')
                .eq('is_archived', false)
                .eq('user_id', state.currentUser.id)
                .order('updated_at', { ascending: false })
                .limit(1);

            if (anyActive && anyActive.length > 0) {
                foundList = anyActive[0];
                // Tag it with the family_id if we're in family mode
                if (state.familyGroupId && !foundList.family_id) {
                    await window.supabase
                        .from('grocery_lists')
                        .update({ family_id: state.familyGroupId })
                        .eq('id', foundList.id);
                    foundList.family_id = state.familyGroupId;
                }
            }
        }

        if (foundList) {
            state.currentList = foundList;

            // Load items for current list
            const { data: items, error: itemsError } = await window.supabase
                .from('grocery_items')
                .select('*')
                .eq('list_id', state.currentList.id)
                .order('created_at', { ascending: true });

            if (itemsError) throw itemsError;

            state.items = (items || []).map(item => {
                if (!item.category) {
                    item.category = autoCategorize(item.name);
                }
                if (isAutoGeneratedNote(item.notes)) {
                    item.notes = '';
                }
                return item;
            });
        } else {
            // Truly no active list exists — create one
            await createNewList();
        }

        // Load frequent items (non-fatal if table doesn't exist)
        try {
            const { data: frequentItems, error: frequentError } = await window.supabase
                .from('frequent_items')
                .select('*')
                .eq('user_id', state.currentUser.id)
                .order('frequency_count', { ascending: false })
                .limit(10);

            if (!frequentError) {
                state.frequentItems = frequentItems || [];
            } else {
                console.warn('Could not load frequent items:', frequentError.message);
                state.frequentItems = [];
            }
        } catch (e) {
            console.warn('Frequent items table may not exist:', e.message);
            state.frequentItems = [];
        }

        // Load category overrides (user's own + family members')
        try {
            const { data: overrides, error: overridesError } = await window.supabase
                .from('item_category_overrides')
                .select('item_name, category, updated_at')
                .order('updated_at', { ascending: false });

            if (!overridesError && overrides) {
                // Build map keyed by lowercase item name.
                // Because we order by updated_at DESC, the first occurrence
                // for each name is the most recent override.
                state.categoryOverrides = {};
                for (const row of overrides) {
                    const key = row.item_name.toLowerCase();
                    if (!state.categoryOverrides[key]) {
                        state.categoryOverrides[key] = row.category;
                    }
                }
            }
        } catch (e) {
            console.warn('Could not load category overrides:', e.message);
        }

        // Load archived lists with their items (own + family)
        let archivedQuery = window.supabase
            .from('grocery_lists')
            .select('*, grocery_items(*)')
            .eq('is_archived', true)
            .order('archived_at', { ascending: false })
            .limit(20);

        if (state.familyGroupId) {
            archivedQuery = archivedQuery.or(`user_id.eq.${state.currentUser.id},family_id.eq.${state.familyGroupId}`);
        } else {
            archivedQuery = archivedQuery.eq('user_id', state.currentUser.id);
        }

        const { data: archivedLists, error: archivedError } = await archivedQuery;

        if (archivedError) throw archivedError;

        state.archivedLists = (archivedLists || []).map(list => ({
            ...list,
            items: list.grocery_items || []
        }));

        // Render UI
        renderItems();
        renderFrequentItems();
        populateRecentListsDropdown();
        updateListTitle();

        // Set up real-time sync
        setupRealtimeSubscription();

        // Save to localStorage as cache
        saveToLocalStorage();

    } catch (error) {
        console.error('Error loading from database:', error);
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
        state.categoryOverrides = data.categoryOverrides || {};
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
    populateRecentListsDropdown();
    updateListTitle();
}

function saveToLocalStorage() {
    const data = {
        currentList: state.currentList,
        items: state.items,
        frequentItems: state.frequentItems,
        archivedLists: state.archivedLists,
        categoryOverrides: state.categoryOverrides
    };
    localStorage.setItem('groceryListData', JSON.stringify(data));
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

async function generateListName() {
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });

    let sequenceNum = 1;
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    if (window.supabase && state.currentUser) {
        try {
            const { data: todaysLists, error } = await window.supabase
                .from('grocery_lists')
                .select('id')
                .eq('user_id', state.currentUser.id)
                .gte('created_at', todayStart.toISOString())
                .lt('created_at', todayEnd.toISOString());

            if (!error && todaysLists) {
                sequenceNum = todaysLists.length + 1;
            }
        } catch (e) {
            console.error('Error counting today\'s lists:', e);
        }
    }

    // Fallback: also count from in-memory archived lists created today
    if (sequenceNum === 1) {
        let todayCount = 0;
        const allLists = [...(state.archivedLists || [])];
        if (state.currentList) allLists.push(state.currentList);

        allLists.forEach(list => {
            const created = new Date(list.created_at);
            if (created >= todayStart && created < todayEnd) {
                todayCount++;
            }
        });

        if (todayCount > 0) {
            sequenceNum = todayCount + 1;
        }
    }

    return `${dateStr} #${sequenceNum}`;
}

async function createNewList(autoAddFrequent = true) {
    const listName = await generateListName();

    const newList = {
        name: listName,
        created_at: new Date().toISOString(),
        is_archived: false
    };

    if (window.supabase && state.currentUser) {
        try {
            // Archive any existing active lists for this user before creating
            // a new one. This ensures the DB unique constraint
            // (one active list per user) is satisfied, and superseded lists
            // are preserved in the archive rather than lost.
            const { data: existingActive } = await window.supabase
                .from('grocery_lists')
                .select('*')
                .eq('user_id', state.currentUser.id)
                .eq('is_archived', false);

            for (const old of (existingActive || [])) {
                await window.supabase
                    .from('grocery_lists')
                    .update({
                        is_archived: true,
                        archived_at: new Date().toISOString(),
                        family_id: old.family_id || state.familyGroupId || null
                    })
                    .eq('id', old.id);

                // Add to local archived lists so it's immediately visible
                // in the archive UI without a full reload
                const { data: oldItems } = await window.supabase
                    .from('grocery_items')
                    .select('*')
                    .eq('list_id', old.id);

                if (oldItems && oldItems.length > 0) {
                    state.archivedLists.unshift({
                        ...old,
                        is_archived: true,
                        archived_at: new Date().toISOString(),
                        items: oldItems
                    });
                }
            }

            const listData = {
                user_id: state.currentUser.id,
                name: listName,
                is_archived: false
            };
            if (state.familyGroupId) {
                listData.family_id = state.familyGroupId;
            }
            const { data, error } = await window.supabase
                .from('grocery_lists')
                .insert([listData])
                .select()
                .single();

            if (error) throw error;

            state.currentList = data;
            state.items = [];

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

            // Set up real-time for new list
            setupRealtimeSubscription();

        } catch (error) {
            console.error('Error creating list in database:', error);
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
    showToast('List archived — new list created', 'success');
}

async function archiveCurrentList() {
    if (!state.currentList || state.items.length === 0) {
        showToast('Nothing to archive', 'warning');
        return;
    }

    if (window.supabase && state.currentUser && state.currentList.id) {
        try {
            const { error } = await window.supabase
                .from('grocery_lists')
                .update({
                    is_archived: true,
                    archived_at: new Date().toISOString()
                })
                .eq('id', state.currentList.id);

            if (error) throw error;

            state.archivedLists.unshift({
                ...state.currentList,
                is_archived: true,
                archived_at: new Date().toISOString(),
                items: [...state.items]
            });

        } catch (error) {
            console.error('Error archiving list:', error);
            archiveListLocally();
        }
    } else {
        archiveListLocally();
    }
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
// RECENT LISTS / DUPLICATE
// ============================================================================

function populateRecentListsDropdown() {
    const dropdown = elements.recentListsDropdown;
    dropdown.innerHTML = '<option value="">Recent lists...</option>';

    const recentLists = state.archivedLists.slice(0, 5);
    if (recentLists.length === 0) return;

    recentLists.forEach((list, index) => {
        const date = new Date(list.archived_at || list.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
        const itemCount = list.items?.length || 0;
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `${list.name} (${date}) - ${itemCount} items`;
        dropdown.appendChild(option);
    });
}

async function duplicateSelectedList() {
    const selectedIndex = elements.recentListsDropdown.value;
    if (selectedIndex === '') {
        showToast('Select a recent list to duplicate', 'warning');
        return;
    }

    const sourceList = state.archivedLists[parseInt(selectedIndex)];
    if (!sourceList || !sourceList.items || sourceList.items.length === 0) {
        showToast('Selected list has no items', 'warning');
        return;
    }

    // Archive current list if it has items
    if (state.items.length > 0) {
        if (!confirm('This will archive your current list and create a duplicate. Continue?')) {
            return;
        }
        await archiveCurrentList();
    }

    // Create a new list without auto-adding frequent items
    await createNewList(false);

    // Copy items from the source list
    for (const item of sourceList.items) {
        const newItem = {
            name: item.name,
            quantity: item.quantity,
            category: item.category,
            notes: item.notes || '',
            is_checked: false,
            created_at: new Date().toISOString()
        };

        if (window.supabase && state.currentUser && state.currentList?.id) {
            await addItemToDatabase(newItem);
        } else {
            newItem.id = Date.now() + Math.random();
            state.items.push(newItem);
        }
    }

    if (!(window.supabase && state.currentUser)) {
        saveToLocalStorage();
    }

    renderItems();
    elements.recentListsDropdown.value = '';
    showToast(`Duplicated "${sourceList.name}" with ${sourceList.items.length} items`, 'success');
}

// ============================================================================
// ADD COMMON ITEMS
// ============================================================================

function getCommonItemsFromHistory() {
    const archived = state.archivedLists || [];
    const commonItems = new Map(); // name (lowercase) -> { name, category, quantity }

    // Check: appeared on 2 of the last 3 lists
    const last3 = archived.slice(0, 3);
    if (last3.length >= 2) {
        const itemCounts = {};
        last3.forEach(list => {
            const items = list.items || list.grocery_items || [];
            const seen = new Set();
            items.forEach(item => {
                const key = item.name.toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    itemCounts[key] = (itemCounts[key] || 0) + 1;
                }
            });
        });
        // Items on 2+ of last 3
        for (const [key, count] of Object.entries(itemCounts)) {
            if (count >= 2) {
                const source = last3.flatMap(l => l.items || l.grocery_items || [])
                    .find(i => i.name.toLowerCase() === key);
                if (source) {
                    commonItems.set(key, {
                        name: source.name,
                        category: source.category || autoCategorize(source.name),
                        quantity: source.quantity || ''
                    });
                }
            }
        }
    }

    // Check: appeared on 4 of the last 10 lists
    const last10 = archived.slice(0, 10);
    if (last10.length >= 4) {
        const itemCounts = {};
        last10.forEach(list => {
            const items = list.items || list.grocery_items || [];
            const seen = new Set();
            items.forEach(item => {
                const key = item.name.toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    itemCounts[key] = (itemCounts[key] || 0) + 1;
                }
            });
        });
        // Items on 4+ of last 10
        for (const [key, count] of Object.entries(itemCounts)) {
            if (count >= 4 && !commonItems.has(key)) {
                const source = last10.flatMap(l => l.items || l.grocery_items || [])
                    .find(i => i.name.toLowerCase() === key);
                if (source) {
                    commonItems.set(key, {
                        name: source.name,
                        category: source.category || autoCategorize(source.name),
                        quantity: source.quantity || ''
                    });
                }
            }
        }
    }

    return Array.from(commonItems.values());
}

async function addCommonItems() {
    // Combine frequency-based items and recency-based items
    const recencyItems = getCommonItemsFromHistory();
    const frequencyItems = state.frequentItems.slice(0, 10).map(fi => ({
        name: fi.name,
        category: fi.category || '',
        quantity: fi.typical_quantity || ''
    }));

    // Merge: recency items first, then frequency items not already included
    const merged = new Map();
    recencyItems.forEach(item => merged.set(item.name.toLowerCase(), item));
    frequencyItems.forEach(item => {
        if (!merged.has(item.name.toLowerCase())) {
            merged.set(item.name.toLowerCase(), item);
        }
    });

    const itemsToAdd = Array.from(merged.values());

    if (itemsToAdd.length === 0) {
        showToast('No common items yet. Shop more to build your frequent items list!', 'info');
        return;
    }

    let addedCount = 0;

    for (const commonItem of itemsToAdd) {
        // Skip if already on list
        if (state.items.find(i => i.name.toLowerCase() === commonItem.name.toLowerCase())) {
            continue;
        }

        const newItem = {
            name: commonItem.name,
            quantity: commonItem.quantity,
            category: commonItem.category || autoCategorize(commonItem.name),
            notes: '',
            is_checked: false,
            created_at: new Date().toISOString()
        };

        if (window.supabase && state.currentUser && state.currentList?.id) {
            await addItemToDatabase(newItem);
        } else {
            newItem.id = Date.now() + Math.random();
            state.items.push(newItem);
        }
        addedCount++;
    }

    if (addedCount === 0) {
        showToast('All common items are already on your list', 'info');
    } else {
        if (!(window.supabase && state.currentUser)) {
            saveToLocalStorage();
        }
        renderItems();
        showToast(`Added ${addedCount} common item${addedCount !== 1 ? 's' : ''}`, 'success');
    }
}

// ============================================================================
// ITEM MANAGEMENT
// ============================================================================

async function addItem() {
    const name = elements.itemInput.value.trim();
    if (!name) return;

    // Check for duplicate
    const duplicate = state.items.find(i => i.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
        showDuplicateWarning(name);
        return;
    }

    const quantity = elements.quantityInput.value.trim();
    let category = elements.categoryInput.value;

    // Auto-categorize if no category selected
    if (!category) {
        category = autoCategorize(name);
    }

    const newItem = {
        name,
        quantity,
        category,
        notes: '',
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

    // Push this item to Skylight — same pattern as deleteFromSkylight (which works)
    syncToSkylight([name]);

    // Clear inputs
    elements.itemInput.value = '';
    elements.quantityInput.value = '';
    elements.categoryInput.value = '';
    elements.categoryInput.style.fontStyle = 'normal';
    elements.itemInput.focus();

    showToast(`Added "${name}"`, 'success');
}

async function addItemToDatabase(item) {
    try {
        // Double-check for duplicates in DB (catches items from other family members)
        const { data: existing } = await window.supabase
            .from('grocery_items')
            .select('name')
            .eq('list_id', state.currentList.id)
            .ilike('name', item.name);

        if (existing && existing.length > 0) {
            showDuplicateWarning(item.name);
            return false;
        }

        const { data, error } = await window.supabase
            .from('grocery_items')
            .insert([{
                list_id: state.currentList.id,
                name: item.name,
                quantity: item.quantity,
                category: item.category,
                notes: item.notes || '',
                added_by: state.currentUser.id,
                is_checked: false
            }])
            .select()
            .single();

        if (error) throw error;

        // Bump the list's updated_at so it's recognized as the most recently
        // modified list when the app reloads or another family member opens it
        await window.supabase
            .from('grocery_lists')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', state.currentList.id);

        // Only push if the realtime handler hasn't already added it
        if (!state.items.find(i => i.id === data.id)) {
            state.items.push(data);
        }
        renderItems();
        saveToLocalStorage();

        return true;

    } catch (error) {
        console.error('Error adding item to database:', error);
        item.id = Date.now() + Math.random();
        state.items.push(item);
        saveToLocalStorage();
        renderItems();
        return false;
    }
}

/**
 * Hourly scheduled sync with Skylight (8am–10pm).
 * Triggers the full two-way sync button logic every 60 minutes.
 */
function setupScheduledSync() {
    setInterval(() => {
        const hour = new Date().getHours();
        if (hour >= 8 && hour <= 22 && state.currentUser) {
            console.log('Scheduled sync: hourly Skylight sync at', new Date().toLocaleTimeString());
            syncFromSkylight();
        }
    }, 60 * 60 * 1000);
}

/**
 * Sync items to Skylight Calendar grocery list (best effort, fails silently)
 */
async function syncToSkylight(items) {
    if (!items || items.length === 0) return;

    try {
        const itemNames = items.map(i => typeof i === 'string' ? i : i.name);
        console.log('syncToSkylight: calling edge function with', itemNames);

        const response = await fetch(
            'https://ilinxxocqvgncglwbvom.supabase.co/functions/v1/sync-skylight',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({ items: itemNames })
            }
        );

        const result = await response.json();
        console.log('Skylight sync response:', response.status, JSON.stringify(result));
        if (!response.ok) {
            console.error('Skylight sync error:', result.error, result.details);
            showToast(`Skylight sync error: ${result.error || response.status}`, 'error');
        } else if (result.version) {
            console.log('Skylight function version:', result.version);
        }
    } catch (error) {
        console.error('Skylight sync failed:', error);
        showToast('Skylight sync failed: ' + error.message, 'error');
    }
}

/**
 * Two-way sync with Skylight Calendar grocery list:
 * 1) Push unchecked app items TO Skylight
 * 2) Pull new Skylight items INTO app
 * 3) Remove app items that were checked off / deleted on Skylight
 */
async function syncFromSkylight() {
    const statusEl = elements.skylightSyncStatus;
    const btn = elements.syncFromSkylightBtn;

    if (!state.currentUser) {
        return;
    }

    if (!window.supabase || !state.currentList?.id) {
        return;
    }

    // Prevent concurrent syncs
    if (state.skylightSyncInProgress) {
        console.log('Skylight sync already in progress, skipping');
        return;
    }
    state.skylightSyncInProgress = true;

    // Show loading state
    btn.disabled = true;
    btn.textContent = '⏳ Syncing...';
    statusEl.classList.remove('hidden');
    statusEl.textContent = 'Pushing items to Skylight...';
    statusEl.className = 'sync-status';

    try {
        // --- Step 1: Pull from Skylight (adds new items + removes checked-off items) ---
        statusEl.textContent = 'Pulling updates from Skylight...';

        const response = await fetch(
            'https://ilinxxocqvgncglwbvom.supabase.co/functions/v1/sync-from-skylight',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({ userId: state.currentUser.id })
            }
        );

        const result = await response.json();
        console.log('Skylight sync result:', JSON.stringify(result, null, 2));

        // --- Step 2: Push ALL unchecked app items TO Skylight ---
        // Edge function v6 has no dedup — just pushes directly. Skylight can handle duplicates.
        statusEl.textContent = 'Pushing items to Skylight...';
        const uncheckedItems = state.items.filter(i => !i.is_checked);
        const itemsToPush = uncheckedItems.map(i => i.name);
        let pushedCount = 0;

        if (itemsToPush.length > 0) {
            console.log(`Pushing ${itemsToPush.length} items to Skylight:`, itemsToPush);
            try {
                const pushResponse = await fetch(
                    'https://ilinxxocqvgncglwbvom.supabase.co/functions/v1/sync-skylight',
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                        },
                        body: JSON.stringify({ items: itemsToPush })
                    }
                );
                const pushResult = await pushResponse.json();
                console.log('Push to Skylight result:', JSON.stringify(pushResult));
                if (pushResult.results) {
                    pushedCount = pushResult.results.filter(r => r.success).length;
                }
            } catch (pushError) {
                console.error('Push to Skylight failed:', pushError);
            }
        }

        // If the edge function already added/removed items, use that result
        if (response.ok && result.success) {
            const parts = [];
            if (pushedCount > 0) {
                parts.push(`Pushed ${pushedCount} to Skylight`);
            }
            if (result.added > 0) {
                parts.push(`Added ${result.added}: ${result.items.join(', ')}`);
            }
            if (result.removed > 0) {
                parts.push(`Removed ${result.removed}: ${result.removedItems.join(', ')}`);
            }
            if (parts.length > 0) {
                statusEl.textContent = `✅ ${parts.join(' | ')}`;
                statusEl.className = 'sync-status success';
                showToast('Synced with Skylight', 'success');
            } else {
                statusEl.textContent = '✅ Everything in sync with Skylight';
                statusEl.className = 'sync-status success';
            }
            await loadFromDatabase();
            return;
        }

        // Edge function didn't add anything — use debug.skylightAllItems to sync from frontend
        // (allSkylightItems already declared above for push dedup)

        console.log('Skylight items full data:', JSON.stringify(allSkylightItems.slice(0, 3), null, 2));

        if (allSkylightItems.length === 0) {
            const parts = [];
            if (pushedCount > 0) parts.push(`Pushed ${pushedCount} to Skylight`);
            parts.push('No items found in Skylight');
            statusEl.textContent = parts.join(' | ');
            statusEl.className = 'sync-status success';
            return;
        }

        const activeItems = allSkylightItems.filter(i => i.status !== 'complete');
        const itemsToSync = activeItems.length > 0 ? activeItems : allSkylightItems;
        const usedFilter = activeItems.length > 0;

        statusEl.textContent = `Found ${allSkylightItems.length} Skylight items${usedFilter ? ` (${activeItems.length} active)` : ''}, checking for new ones...`;

        // Get all existing items in the current list (checked + unchecked)
        const { data: existingItems } = await window.supabase
            .from('grocery_items')
            .select('name')
            .eq('list_id', state.currentList.id);

        const existingNames = new Set(
            (existingItems || []).map(i => i.name.toLowerCase().trim())
        );

        // Find items in Skylight that aren't in our app
        const newItems = itemsToSync
            .map(i => i.label)
            .filter(label => label && !existingNames.has(label.toLowerCase().trim()));

        // Insert new items directly via supabase
        const addedNames = [];
        for (const name of newItems) {
            const { error } = await window.supabase
                .from('grocery_items')
                .insert({
                    list_id: state.currentList.id,
                    name: name,
                    category: autoCategorize(name),
                    is_checked: false,
                    added_by: state.currentUser.id,
                    notes: 'From Skylight',
                });

            if (!error) {
                addedNames.push(name);
            } else if (error.code !== '23505') {
                console.error(`Failed to insert ${name}:`, error.message);
            }
        }

        if (addedNames.length > 0) {
            await window.supabase
                .from('grocery_lists')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', state.currentList.id);
        }

        const parts = [];
        if (pushedCount > 0) parts.push(`Pushed ${pushedCount} to Skylight`);
        if (addedNames.length > 0) parts.push(`Added ${addedNames.length}: ${addedNames.join(', ')}`);

        if (parts.length > 0) {
            statusEl.textContent = `✅ ${parts.join(' | ')}`;
            statusEl.className = 'sync-status success';
            showToast('Synced with Skylight', 'success');
            await loadFromDatabase();
        } else {
            statusEl.textContent = '✅ Everything in sync with Skylight';
            statusEl.className = 'sync-status success';
        }
    } catch (error) {
        console.error('Sync with Skylight failed:', error);
        statusEl.textContent = '❌ Connection error';
        statusEl.className = 'sync-status error';
        showToast('Failed to connect to Skylight', 'error');
    } finally {
        state.skylightSyncInProgress = false;
        btn.disabled = false;
        btn.textContent = '🔄 Sync with Skylight';
    }
}

async function toggleItem(itemId) {
    const item = state.items.find(i => i.id == itemId);
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

    // Sync check-off to Skylight (mark as complete = remove from active list)
    if (item.is_checked && item.name) {
        deleteFromSkylight(item.name);
    }

    renderItems();
}

async function deleteItem(itemId) {
    const item = state.items.find(i => i.id == itemId);
    const itemName = item ? item.name : '';

    state.items = state.items.filter(i => i.id != itemId);
    renderItems();
    saveToLocalStorage();

    if (window.supabase && state.currentUser && state.currentList?.id) {
        try {
            const { error } = await window.supabase
                .from('grocery_items')
                .delete()
                .eq('id', itemId);

            if (error) throw error;
        } catch (error) {
            console.error('Error deleting item from database:', error);
        }
    }

    // Sync delete to Skylight (best effort, fails silently)
    if (itemName) {
        deleteFromSkylight(itemName);
        showToast(`Removed "${itemName}"`, 'info');
    }
}

/**
 * Delete an item from Skylight Calendar grocery list (best effort, fails silently)
 */
async function deleteFromSkylight(itemName) {
    if (!itemName) return;

    try {
        const response = await fetch(
            'https://ilinxxocqvgncglwbvom.supabase.co/functions/v1/sync-skylight',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({ deleteItems: [itemName] })
            }
        );

        const result = await response.json();
        console.log('Skylight delete response:', response.status, JSON.stringify(result));
        if (!response.ok) {
            console.error('Skylight delete error:', result.error, result.details);
        }
    } catch (error) {
        console.error('Skylight delete sync failed:', error);
    }
}

let currentEditItemId = null;

function openEditModal(itemId) {
    const item = state.items.find(i => i.id == itemId);
    if (!item) return;

    currentEditItemId = itemId;
    elements.editItemName.value = item.name;
    elements.editItemQuantity.value = item.quantity || '';
    elements.editItemCategory.value = item.category || '';
    elements.editItemNotes.value = item.notes || '';

    elements.editModal.classList.remove('hidden');
}

function closeEditModal() {
    currentEditItemId = null;
    elements.editModal.classList.add('hidden');
}

async function saveEditedItem() {
    if (!currentEditItemId) return;

    const item = state.items.find(i => i.id == currentEditItemId);
    if (!item) return;

    const newName = elements.editItemName.value.trim();
    const newQuantity = elements.editItemQuantity.value.trim();
    const newCategory = elements.editItemCategory.value;
    const newNotes = elements.editItemNotes.value.trim();

    if (!newName) {
        showToast('Item name cannot be empty', 'error');
        return;
    }

    const oldCategory = item.category;
    item.name = newName;
    item.quantity = newQuantity;
    item.category = newCategory;
    item.notes = newNotes;

    // If category changed, save the override so future adds use this category
    const categoryChanged = newCategory && newCategory !== oldCategory;
    if (categoryChanged) {
        saveCategoryOverride(newName, newCategory);
    }

    if (window.supabase && state.currentUser && state.currentList?.id) {
        try {
            const { error } = await window.supabase
                .from('grocery_items')
                .update({
                    name: item.name,
                    quantity: item.quantity,
                    category: item.category,
                    notes: item.notes
                })
                .eq('id', currentEditItemId);

            if (error) throw error;

        } catch (error) {
            console.error('Error updating item:', error);
            saveToLocalStorage();
        }
    } else {
        saveToLocalStorage();
    }

    closeEditModal();
    renderItems();
    showToast('Item updated', 'success');
}

async function saveCategoryOverride(itemName, category) {
    const key = itemName.toLowerCase();

    // Update local state immediately
    state.categoryOverrides[key] = category;
    saveToLocalStorage();

    // Also update the frequent_items table if this item exists there
    if (window.supabase && state.currentUser) {
        try {
            // Upsert the override in the database
            await window.supabase
                .from('item_category_overrides')
                .upsert({
                    user_id: state.currentUser.id,
                    item_name: key,
                    category: category,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'user_id,item_name'
                });

            // Keep frequent_items in sync
            await window.supabase
                .from('frequent_items')
                .update({ category: category })
                .eq('user_id', state.currentUser.id)
                .ilike('name', key);

        } catch (error) {
            console.error('Error saving category override:', error);
        }
    }

    // Update local frequent items too
    const fi = state.frequentItems.find(f => f.name.toLowerCase() === key);
    if (fi) {
        fi.category = category;
    }
}

async function saveInlineNotes(itemId) {
    const item = state.items.find(i => i.id == itemId);
    if (!item) return;

    const notesInput = document.querySelector(`.item-notes-input[data-item-id="${itemId}"]`);
    if (!notesInput) return;

    item.notes = notesInput.value.trim();

    if (window.supabase && state.currentUser && state.currentList?.id) {
        try {
            const { error } = await window.supabase
                .from('grocery_items')
                .update({ notes: item.notes })
                .eq('id', itemId);

            if (error) throw error;
        } catch (error) {
            console.error('Error saving notes:', error);
            saveToLocalStorage();
        }
    } else {
        saveToLocalStorage();
    }

    renderItems();
    showToast('Notes saved', 'success');
}

async function addFrequentItem(itemName, category, quantity) {
    // Check if already in list
    if (state.items.find(i => i.name.toLowerCase() === itemName.toLowerCase())) {
        showToast(`"${itemName}" is already in your list`, 'warning');
        return;
    }

    const newItem = {
        name: itemName,
        quantity: quantity,
        category: category,
        notes: '',
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

    showToast(`Added "${itemName}"`, 'success');
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

    showToast('Frequent items cleared', 'success');
}

// ============================================================================
// SWIPE TO DELETE (Mobile)
// ============================================================================

function setupSwipeHandlers() {
    const items = document.querySelectorAll('.item');
    items.forEach(itemEl => {
        let startX = 0;
        let currentX = 0;
        let isSwiping = false;

        itemEl.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            isSwiping = false;
        }, { passive: true });

        itemEl.addEventListener('touchmove', (e) => {
            currentX = e.touches[0].clientX;
            const diff = startX - currentX;

            if (diff > 10) {
                isSwiping = true;
                itemEl.classList.add('swiping');
                const translateX = Math.min(diff, 80);
                itemEl.style.transform = `translateX(-${translateX}px)`;
            }
        }, { passive: true });

        itemEl.addEventListener('touchend', () => {
            const diff = startX - currentX;

            if (isSwiping && diff > 60) {
                // Swipe threshold met - delete
                const itemId = itemEl.querySelector('.item-checkbox')?.dataset.itemId;
                if (itemId) {
                    itemEl.classList.add('removing');
                    setTimeout(() => deleteItem(itemId), 300);
                }
            } else {
                // Reset position
                itemEl.classList.remove('swiping');
                itemEl.style.transform = '';
            }

            isSwiping = false;
        }, { passive: true });
    });
}

// ============================================================================
// FAMILY GROUP & INVITATIONS
// ============================================================================

async function loadFamilyMembers() {
    if (!window.supabase || !state.currentUser) return;

    try {
        // Check if user belongs to a family group
        const { data: memberships, error: memberError } = await window.supabase
            .from('family_members')
            .select('*')
            .eq('user_id', state.currentUser.id)
            .eq('status', 'accepted');

        if (memberError) throw memberError;

        if (memberships && memberships.length > 0) {
            state.familyGroupId = memberships[0].family_group_id;

            // Retroactively tag any untagged lists with family_id
            // This ensures lists created before joining the family are shared
            await migrateUserListsToFamily(state.familyGroupId);

            // Load all members of the group
            const { data: members, error: groupError } = await window.supabase
                .from('family_members')
                .select('*')
                .eq('family_group_id', state.familyGroupId);

            if (groupError) throw groupError;

            state.familyMembers = members || [];
        } else {
            state.familyMembers = [];
            state.familyGroupId = null;
        }

        // Also check for pending invites TO this user
        const { data: pendingInvites, error: inviteError } = await window.supabase
            .from('family_members')
            .select('*')
            .eq('email', state.currentUser.email)
            .eq('status', 'pending');

        if (!inviteError && pendingInvites && pendingInvites.length > 0) {
            showPendingInvite(pendingInvites[0]);
        }

    } catch (error) {
        console.error('Error loading family members:', error);
    }

    renderFamilyMembers();
}

async function sendFamilyInvite() {
    const email = elements.inviteEmail.value.trim();
    if (!email) {
        showToast('Enter an email address', 'warning');
        return;
    }

    if (!state.currentUser) {
        showToast('Sign in to invite family members', 'warning');
        return;
    }

    try {
        // Create or get family group
        let groupId = state.familyGroupId;
        if (!groupId) {
            // Create a new family group
            const { data: group, error: groupError } = await window.supabase
                .from('family_groups')
                .insert([{
                    created_by: state.currentUser.id,
                    name: `${state.currentUser.email}'s Family`
                }])
                .select()
                .single();

            if (groupError) throw groupError;

            groupId = group.id;
            state.familyGroupId = groupId;

            // Tag ALL of this user's lists (active + archived) with family_id
            // so the entire history is shared with family members
            await migrateUserListsToFamily(groupId);

            // Also ensure the current active list is tagged in the database
            // (migrateUserListsToFamily handles this, but update local state too)
            if (state.currentList) {
                if (state.currentList.id) {
                    await window.supabase
                        .from('grocery_lists')
                        .update({ family_id: groupId })
                        .eq('id', state.currentList.id);
                }
                state.currentList.family_id = groupId;
            }

            // Add self as accepted member
            await window.supabase
                .from('family_members')
                .insert([{
                    family_group_id: groupId,
                    user_id: state.currentUser.id,
                    email: state.currentUser.email,
                    status: 'accepted',
                    invited_by: state.currentUser.id
                }]);
        }

        // Check if already invited
        const existing = state.familyMembers.find(m => m.email === email);
        if (existing) {
            showToast(`${email} is already ${existing.status === 'accepted' ? 'a member' : 'invited'}`, 'warning');
            return;
        }

        // Send invite
        const { data: invite, error: inviteError } = await window.supabase
            .from('family_members')
            .insert([{
                family_group_id: groupId,
                email: email,
                status: 'pending',
                invited_by: state.currentUser.id
            }])
            .select()
            .single();

        if (inviteError) throw inviteError;

        state.familyMembers.push(invite);
        renderFamilyMembers();
        elements.inviteEmail.value = '';

        // Send invite email via Edge Function (non-blocking)
        try {
            await window.supabase.functions.invoke('send-invite-email', {
                body: {
                    email: email,
                    invited_by: state.currentUser.id,
                    family_group_id: groupId
                }
            });
            showToast(`Invitation emailed to ${email}`, 'success');
        } catch (emailErr) {
            console.warn('Could not send invite email:', emailErr);
            showToast(`Invitation created for ${email} (email notification unavailable)`, 'success');
        }

    } catch (error) {
        console.error('Error sending invite:', error);
        showToast('Failed to send invitation', 'error');
    }
}

function showPendingInvite(invite) {
    elements.inviteMessage.textContent =
        `You've been invited to join a family grocery group. Accept to share lists with all group members.`;
    elements.inviteModal.dataset.inviteId = invite.id;
    elements.inviteModal.dataset.groupId = invite.family_group_id;
    elements.inviteModal.classList.remove('hidden');
}

async function acceptInvite() {
    const inviteId = elements.inviteModal.dataset.inviteId;
    const groupId = elements.inviteModal.dataset.groupId;

    if (!inviteId || !state.currentUser) return;

    try {
        const { error } = await window.supabase
            .from('family_members')
            .update({
                status: 'accepted',
                user_id: state.currentUser.id
            })
            .eq('id', inviteId);

        if (error) throw error;

        state.familyGroupId = groupId;
        elements.inviteModal.classList.add('hidden');

        // Retroactively tag all of this user's existing lists with family_id
        // so they appear in the shared family archive
        await migrateUserListsToFamily(groupId);

        showToast('Welcome to the family group!', 'success');
        await loadFamilyMembers();
        await loadFromDatabase();

    } catch (error) {
        console.error('Error accepting invite:', error);
        showToast('Failed to accept invitation', 'error');
    }
}

// Tag ALL of a user's untagged lists (active + archived) with the family group ID
// so they are visible to all family members. This is idempotent — lists already
// tagged with family_id are skipped (family_id IS NULL filter).
async function migrateUserListsToFamily(groupId) {
    if (!window.supabase || !state.currentUser || !groupId) return;

    try {
        await window.supabase
            .from('grocery_lists')
            .update({ family_id: groupId })
            .eq('user_id', state.currentUser.id)
            .is('family_id', null);
    } catch (error) {
        console.error('Error migrating lists to family:', error);
    }
}

function renderFamilyMembers() {
    if (state.familyMembers.length === 0) {
        elements.familyMembersList.innerHTML = '<p class="help-text">No family members yet. Send an invite!</p>';
        return;
    }

    const html = state.familyMembers.map(member => `
        <div class="family-member">
            <span class="member-email">${escapeHtml(member.email || 'Unknown')}</span>
            <span class="member-status ${member.status}">${member.status === 'accepted' ? 'Member' : 'Pending'}</span>
        </div>
    `).join('');

    elements.familyMembersList.innerHTML = html;
}

function checkForInvite() {
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get('invite');
    if (inviteToken) {
        localStorage.setItem('pendingInviteToken', inviteToken);
    }
}

// ============================================================================
// SMS PHONE REGISTRATION
// ============================================================================

function normalizePhoneNumber(phone) {
    // Strip everything except digits and leading +
    let cleaned = phone.replace(/[\s\-().]/g, '');
    // If no country code, assume US (+1)
    if (cleaned.match(/^\d{10}$/)) {
        cleaned = '+1' + cleaned;
    } else if (cleaned.match(/^1\d{10}$/)) {
        cleaned = '+' + cleaned;
    }
    return cleaned;
}

async function loadPhoneNumber() {
    if (!window.supabase || !state.currentUser) return;

    try {
        const { data, error } = await window.supabase
            .from('user_phones')
            .select('phone_number')
            .eq('user_id', state.currentUser.id)
            .limit(1)
            .single();

        if (!error && data) {
            elements.phoneNumberInput.value = data.phone_number;
            elements.phoneStatus.textContent = 'Phone number registered';
            elements.phoneStatus.className = 'phone-status phone-status-ok';
            elements.phoneStatus.classList.remove('hidden');
            showSmsInstructions();
        }
    } catch (e) {
        console.warn('Could not load phone number:', e.message);
    }
}

async function savePhoneNumber() {
    const raw = elements.phoneNumberInput.value.trim();
    if (!raw) {
        showToast('Enter a phone number', 'warning');
        return;
    }

    if (!state.currentUser) {
        showToast('Sign in to register your phone number', 'warning');
        return;
    }

    const phone = normalizePhoneNumber(raw);

    // Basic validation
    if (!/^\+\d{10,15}$/.test(phone)) {
        showToast('Enter a valid phone number (e.g. +1 555 123 4567)', 'warning');
        return;
    }

    try {
        // Upsert: insert or update if user already has a phone registered
        const { error } = await window.supabase
            .from('user_phones')
            .upsert({
                user_id: state.currentUser.id,
                phone_number: phone,
                verified: true
            }, {
                onConflict: 'phone_number'
            });

        if (error) throw error;

        elements.phoneNumberInput.value = phone;
        elements.phoneStatus.textContent = 'Phone number saved';
        elements.phoneStatus.className = 'phone-status phone-status-ok';
        elements.phoneStatus.classList.remove('hidden');
        showSmsInstructions();
        showToast('Phone number registered for SMS', 'success');

    } catch (error) {
        console.error('Error saving phone number:', error);
        if (error.message?.includes('unique') || error.code === '23505') {
            showToast('This phone number is already registered to another account', 'error');
        } else {
            showToast('Failed to save phone number', 'error');
        }
    }
}

function showSmsInstructions() {
    if (elements.smsInstructions) {
        elements.smsInstructions.classList.remove('hidden');
    }
    if (elements.smsNumber) {
        elements.smsNumber.textContent = '(973) 240-5157';
    }
}

// ============================================================================
// AUTO-CATEGORIZATION
// ============================================================================

function autoCategorize(itemName) {
    const name = itemName.toLowerCase();

    // Check user/family category overrides first
    if (state.categoryOverrides[name]) {
        return state.categoryOverrides[name];
    }

    // Bakery
    if (/bread|bun\b|rolls?\b|bagel|croissant|muffin|donut|cake\b|cookie|pastry|biscuit|scone|waffle|pancake|tortilla|pita/.test(name)) {
        return 'bakery';
    }

    // Cheese
    if (/cheese|cheddar|mozzarella|parmesan|brie|feta|gouda|swiss|provolone/.test(name)) {
        return 'cheese';
    }

    // Meat
    if (/chicken|beef|pork|fish|turkey|lamb|meat|steak|bacon|sausage|hamburger|ham\b|salmon|tuna|shrimp|ribs?\b|roast|brisket|chop|wing|thigh|breast|drumstick|ground\b|hot dog|bratwurst|jerky|veal|venison/.test(name)) {
        return 'meat';
    }

    // Pantry/Canned goods
    if (/rice|pasta|bean|soup|sauce|oil\b|vinegar|spice|flour|sugar|salt\b|pepper|cereal|oat|jar|noodle|pickle|canned|broth|ketchup|mustard|mayo|honey|syrup|peanut butter|jelly|jam/.test(name)) {
        return 'pantry';
    }

    // Dairy
    if (/milk|yogurt|butter|cream\b|eggs?\b/.test(name)) {
        return 'dairy';
    }

    // Produce
    if (/apple|banana|orange|grape|berry|lettuce|tomato|potato|onion|carrot|celery|spinach|kale|broccoli|cucumber|bell pepper|jalape|fruit|vegetable|avocado|lemon|lime|garlic|mushroom|zucchini|squash|corn\b|peas?\b|peach|pear\b|plum|mango|melon|watermelon|cantaloupe|pineapple|cherry|cabbage|cauliflower|asparagus|radish|beet|turnip|herb|cilantro|parsley|basil|ginger|green onion|scallion/.test(name)) {
        return 'produce';
    }

    // Frozen
    if (/frozen|ice cream|pizza|fries|popsicle/.test(name)) {
        return 'frozen';
    }

    // Beverages
    if (/water\b|juice|soda|coffee|\btea\b|wine\b|beer|kombucha|drink|sparkling/.test(name)) {
        return 'beverages';
    }

    // Snacks
    if (/chips?\b|cracker|nuts?\b|popcorn|pretzel|trail mix|granola|candy|chocolate/.test(name)) {
        return 'snacks';
    }

    // Household
    if (/soap|detergent|paper\b|towel|tissue|trash|bags?\b|sponge|cleaner|bleach|wrap\b|foil|plastic/.test(name)) {
        return 'household';
    }

    return '';
}

// ============================================================================
// UI RENDERING
// ============================================================================

function updateListTitle() {
    if (state.currentList) {
        elements.listTitle.textContent = state.currentList.name;
    }
}

function startEditingTitle() {
    if (!state.currentList) return;

    const titleEl = elements.listTitle;
    const currentName = state.currentList.name;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'edit-title-input';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '✓';
    saveBtn.className = 'btn btn-primary save-title-btn';

    const wrapper = titleEl.parentNode;
    const editBtn = wrapper.querySelector('.edit-title-btn');
    titleEl.classList.add('hidden');
    if (editBtn) editBtn.classList.add('hidden');

    wrapper.insertBefore(input, editBtn);
    wrapper.insertBefore(saveBtn, editBtn);
    input.focus();
    input.select();

    async function saveTitle() {
        const newName = input.value.trim();
        if (!newName) {
            cancelEdit();
            return;
        }

        state.currentList.name = newName;

        if (window.supabase && state.currentUser && state.currentList.id) {
            try {
                await window.supabase
                    .from('grocery_lists')
                    .update({ name: newName })
                    .eq('id', state.currentList.id);
            } catch (e) {
                console.error('Error saving list name:', e);
            }
        } else {
            saveToLocalStorage();
        }

        cancelEdit();
        updateListTitle();
        showToast('List renamed', 'success');
    }

    function cancelEdit() {
        if (input.parentNode) input.remove();
        if (saveBtn.parentNode) saveBtn.remove();
        titleEl.classList.remove('hidden');
        if (editBtn) editBtn.classList.remove('hidden');
    }

    saveBtn.addEventListener('click', saveTitle);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveTitle();
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') cancelEdit();
    });
}

function renderItems() {
    if (state.items.length === 0) {
        elements.itemsList.innerHTML = '<p class="empty-state">Your list is empty. Add some items to get started!</p>';
        elements.listStats.classList.add('hidden');
        return;
    }

    let itemsToRender = [...state.items];

    // Always group by category
    const categoryOrder = ['bakery', 'cheese', 'meat', 'pantry', 'dairy', 'produce', 'frozen', 'beverages', 'snacks', 'household', 'other'];
    const categories = {};
    categoryOrder.forEach(cat => {
        categories[cat] = [];
    });

    itemsToRender.forEach(item => {
        const cat = item.category || 'other';
        if (categories[cat]) {
            categories[cat].push(item);
        } else {
            categories.other.push(item);
        }
    });

    const categoryEmoji = {
        'bakery': '🍞',
        'cheese': '🧀',
        'meat': '🥩',
        'pantry': '🥫',
        'dairy': '🥛',
        'produce': '🥬',
        'frozen': '❄️',
        'beverages': '🥤',
        'snacks': '🍿',
        'household': '🧼',
        'other': '📦'
    };

    let html = '';
    categoryOrder.forEach(category => {
        const items = categories[category];
        if (items && items.length > 0) {
            html += `<div class="category-group">
                <h3 class="category-title">${categoryEmoji[category]} ${category.charAt(0).toUpperCase() + category.slice(1)}</h3>
                ${items.map(renderItemHTML).join('')}
            </div>`;
        }
    });

    elements.itemsList.innerHTML = html;

    // Update stats
    const total = state.items.length;
    const checked = state.items.filter(i => i.is_checked).length;
    elements.totalItems.textContent = `${total} item${total !== 1 ? 's' : ''}`;
    elements.checkedItems.textContent = `${checked} checked`;
    elements.listStats.classList.remove('hidden');

    // Add progress bar
    const progressPercent = total > 0 ? Math.round((checked / total) * 100) : 0;
    const existingProgress = elements.listStats.querySelector('.list-progress');
    if (!existingProgress) {
        const progressHtml = `<div class="list-progress"><div class="list-progress-bar" style="width: ${progressPercent}%"></div></div>`;
        elements.listStats.insertAdjacentHTML('beforeend', progressHtml);
    } else {
        existingProgress.querySelector('.list-progress-bar').style.width = `${progressPercent}%`;
    }

    // Setup swipe handlers for mobile
    setupSwipeHandlers();
}

function renderItemHTML(item) {
    const hasNotes = item.notes && item.notes.trim() && !isAutoGeneratedNote(item.notes);
    return `
        <div class="item ${item.is_checked ? 'checked' : ''}">
            <div class="item-details">
                <div class="item-top-row">
                    <input type="checkbox"
                           class="item-checkbox"
                           data-item-id="${item.id}"
                           ${item.is_checked ? 'checked' : ''}>
                    <span class="item-name">${escapeHtml(item.name)}</span>
                    ${item.quantity ? `<span class="item-quantity">${escapeHtml(item.quantity)}</span>` : ''}
                </div>
                ${hasNotes
                    ? `<div class="item-notes">${escapeHtml(item.notes)}</div>`
                    : `<input type="text" class="item-notes-input" data-item-id="${item.id}" placeholder="Add a note..." value="">`
                }
            </div>
            <div class="item-actions">
                ${!hasNotes ? `<button class="save-notes-btn" data-item-id="${item.id}" title="Save notes">💾</button>` : ''}
                <button class="edit-item-btn" data-item-id="${item.id}" title="Edit">✏️</button>
                <button class="delete-item-btn" data-item-id="${item.id}" title="Delete">🗑️</button>
            </div>
            <div class="item-swipe-bg">🗑️</div>
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
            ${item.frequency_count > 1 ? `<span class="frequency-badge">${item.frequency_count}x</span>` : ''}
        </button>
    `).join('');

    elements.frequentItemsList.innerHTML = html;

    // Add event listeners
    document.querySelectorAll('.frequent-item-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.target.closest('.frequent-item-btn');
            const name = target.dataset.name;
            const category = target.dataset.category;
            const quantity = target.dataset.quantity;
            addFrequentItem(name, category, quantity);
        });
    });
}

async function showArchivedLists() {
    if (window.supabase && state.currentUser) {
        try {
            let archiveQuery = window.supabase
                .from('grocery_lists')
                .select('*, grocery_items(*)')
                .eq('is_archived', true)
                .order('archived_at', { ascending: false })
                .limit(20);

            if (state.familyGroupId) {
                archiveQuery = archiveQuery.or(`user_id.eq.${state.currentUser.id},family_id.eq.${state.familyGroupId}`);
            } else {
                archiveQuery = archiveQuery.eq('user_id', state.currentUser.id);
            }

            const { data, error } = await archiveQuery;

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
        showToast('No archived lists yet', 'info');
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
    elements.settingsModal.classList.add('hidden');
}

// ============================================================================
// UTILITIES
// ============================================================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function isAutoGeneratedNote(notes) {
    if (!notes) return true;
    const trimmed = notes.trim().toLowerCase();
    return trimmed === 'added via text' || trimmed === 'auto-added common item';
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
    archiveCurrentList,
    addCommonItems
};
