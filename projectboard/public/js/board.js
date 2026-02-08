// TaskBoard - Board JavaScript

let ws = null;
let wsReconnectTimeout = null;

document.addEventListener('DOMContentLoaded', () => {
  initDragAndDrop();
  initModal();
  initStatusSelects();
  initEditButtons();
  initComments();
  initAttachments();
  initWebSocket();
  linkifyExistingContent();
});

// Linkify ticket numbers in server-rendered content
function linkifyExistingContent() {
  // Linkify descriptions on task cards (board view)
  document.querySelectorAll('.task-description').forEach(el => {
    el.innerHTML = linkifyTicketNumbers(el.innerHTML);
  });
  
  // Linkify descriptions in table cells (backlog/archive view)
  document.querySelectorAll('.task-desc').forEach(el => {
    el.innerHTML = linkifyTicketNumbers(el.innerHTML);
  });
}

// ================== WebSocket for Real-Time Updates ==================

function initWebSocket() {
  if (!window.BOARD_ID) return;
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  function connect() {
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      // Subscribe to this board
      ws.send(JSON.stringify({ type: 'subscribe', boardId: window.BOARD_ID }));
      
      // Show connected indicator
      updateConnectionStatus(true);
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      } catch (e) {
        console.error('WebSocket message parse error:', e);
      }
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      updateConnectionStatus(false);
      
      // Reconnect after 3 seconds
      wsReconnectTimeout = setTimeout(() => {
        console.log('Reconnecting WebSocket...');
        connect();
      }, 3000);
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }
  
  connect();
}

function updateConnectionStatus(connected) {
  let indicator = document.getElementById('ws-status');
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.id = 'ws-status';
    indicator.style.cssText = 'margin-left: 0.5rem; font-size: 0.8rem;';
    const nav = document.querySelector('nav');
    if (nav) nav.appendChild(indicator);
  }
  indicator.textContent = connected ? '🟢' : '🔴';
  indicator.title = connected ? 'Real-time updates active' : 'Reconnecting...';
}

// Format email to friendly display name (e.g., "ashley@mnemoshare.com" → "Ashley")
function formatUserDisplayName(email) {
  if (!email) return 'Someone';
  const name = email.split('@')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function handleWebSocketMessage(data) {
  console.log('WebSocket event:', data.type, data);
  
  const user = data.user ? formatUserDisplayName(data.user) : null;
  
  switch (data.type) {
    case 'subscribed':
      console.log('Subscribed to board:', data.boardId);
      break;
      
    case 'task_created':
      handleTaskCreated(data.task, user);
      break;
      
    case 'task_updated':
      handleTaskUpdated(data.task, data.changes, user);
      break;
      
    case 'task_deleted':
      handleTaskDeleted(data.taskId, user);
      break;
      
    case 'comment_added':
      handleCommentAdded(data.taskId, data.comment, user);
      break;
  }
}

function handleTaskCreated(task, user) {
  // Add new task card to the appropriate column
  const column = document.querySelector(`.task-list[data-status="${task.status}"]`);
  if (!column) return;
  
  const card = createTaskCard(task);
  column.insertBefore(card, column.firstChild);
  
  // Update count
  updateColumnCount(task.status);
  
  // Flash animation
  card.style.animation = 'flash-new 1s ease-out';
  
  const message = user 
    ? `${user} created: ${task.name}`
    : `New task: ${task.name}`;
  showToast(message, 'info');
}

function handleTaskUpdated(task, changes, user) {
  const card = document.querySelector(`.task-card[data-id="${task._id}"]`);
  
  if (changes && changes.statusChanged) {
    // Move card to new column
    if (card) card.remove();
    
    // Don't add if moved to closed (not shown on board)
    if (task.status !== 'closed') {
      const newColumn = document.querySelector(`.task-list[data-status="${task.status}"]`);
      if (newColumn) {
        const newCard = createTaskCard(task);
        newColumn.insertBefore(newCard, newColumn.firstChild);
        newCard.style.animation = 'flash-update 0.5s ease-out';
      }
    }
    
    // Update counts
    if (changes.oldStatus) updateColumnCount(changes.oldStatus);
    updateColumnCount(task.status);
    
    const message = user
      ? `${user} moved ${task.name} → ${formatStatus(task.status)}`
      : `Task moved: ${task.name} → ${formatStatus(task.status)}`;
    showToast(message, 'info');
  } else if (card) {
    // Update card in place
    const newCard = createTaskCard(task);
    card.replaceWith(newCard);
    newCard.style.animation = 'flash-update 0.5s ease-out';
  }
  
  // If modal is open for this task, update it
  if (currentTaskId === task._id.toString()) {
    // Refresh modal data
    openModal(task._id);
  }
}

function handleTaskDeleted(taskId, user) {
  const card = document.querySelector(`.task-card[data-id="${taskId}"]`);
  if (card) {
    const status = card.closest('.task-list')?.dataset.status;
    card.style.animation = 'fade-out 0.3s ease-out';
    setTimeout(() => {
      card.remove();
      if (status) updateColumnCount(status);
    }, 300);
    
    const message = user ? `${user} deleted a task` : 'Task deleted';
    showToast(message, 'warning');
  }
  
  // Close modal if open for this task
  if (currentTaskId === taskId) {
    closeModal();
  }
}

function handleCommentAdded(taskId, comment, user) {
  // If modal is open for this task, add the comment
  if (currentTaskId === taskId) {
    const commentsList = document.getElementById('commentsList');
    if (commentsList) {
      const commentEl = createCommentElement(comment);
      commentsList.appendChild(commentEl);
      commentsList.scrollTop = commentsList.scrollHeight;
    }
  }
  
  // Update comment count on card
  const card = document.querySelector(`.task-card[data-id="${taskId}"]`);
  if (card) {
    let countEl = card.querySelector('.comment-count');
    if (countEl) {
      const count = parseInt(countEl.textContent.replace('💬 ', '')) + 1;
      countEl.textContent = `💬 ${count}`;
    } else {
      const meta = card.querySelector('.task-meta');
      if (meta) {
        countEl = document.createElement('span');
        countEl.className = 'comment-count';
        countEl.title = 'Comments';
        countEl.textContent = '💬 1';
        meta.insertBefore(countEl, meta.querySelector('.assignee'));
      }
    }
  }
}

function createTaskCard(task) {
  const card = document.createElement('div');
  card.className = 'task-card';
  card.dataset.id = task._id;
  card.draggable = true;
  
  const assignee = window.USERS?.find(u => u.email === task.assignee);
  const commentCount = task.comments?.length || 0;
  
  const descriptionText = task.description ? task.description.substring(0, 100) + (task.description.length > 100 ? '...' : '') : '';
  const descriptionHtml = linkifyTicketNumbers(escapeHtml(descriptionText));
  
  const typeBadge = (task.type && task.type !== 'story') ? `<span class="type-badge type-${escapeHtml(task.type)}">${escapeHtml(task.type)}</span>` : '';

  card.innerHTML = `
    <div class="task-priority priority-${task.priority}"></div>
    ${task.ticketNumber ? `<span class="ticket-number">${escapeHtml(task.ticketNumber)}</span>` : ''}
    ${typeBadge}
    <h3>${escapeHtml(task.name)}</h3>
    <p class="task-description">${descriptionHtml}</p>
    <div class="task-meta">
      <span class="complexity" title="Story Points">${task.complexity || '-'} pts</span>
      ${commentCount > 0 ? `<span class="comment-count" title="Comments">💬 ${commentCount}</span>` : ''}
      ${task.assignee ? `<span class="assignee" title="${assignee?.name || task.assignee}">${assignee?.avatar || '👤'}</span>` : ''}
    </div>
  `;
  
  // Add event listeners
  card.addEventListener('dragstart', handleDragStart);
  card.addEventListener('dragend', handleDragEnd);
  card.addEventListener('click', (e) => {
    if (!e.target.classList.contains('task-card')) return;
    openModal(card.dataset.id);
  });
  card.addEventListener('dblclick', () => openModal(card.dataset.id));
  
  return card;
}

function createCommentElement(comment) {
  const div = document.createElement('div');
  div.className = 'comment';
  div.innerHTML = `
    <div class="comment-header">
      <span class="comment-author">${escapeHtml(comment.authorName || comment.author)}</span>
      <span class="comment-time">${formatTime(comment.timestamp)}</span>
    </div>
    <div class="comment-text">${linkifyTicketNumbers(highlightMentions(escapeHtml(comment.text)))}</div>
  `;
  return div;
}

function updateColumnCount(status) {
  const column = document.querySelector(`.column[data-status="${status}"]`);
  if (!column) return;
  
  const count = column.querySelectorAll('.task-card').length;
  const countEl = column.querySelector('.task-count');
  if (countEl) countEl.textContent = count;
}

function formatStatus(status) {
  const labels = {
    'backlog': 'Backlog',
    'todo': 'TODO',
    'in-progress': 'In Progress',
    'blocked': 'Blocked',
    'in-review': 'In Review',
    'in-qa': 'In QA',
    'completed': 'Completed',
    'rfp': 'Ready for Prod',
    'closed': 'Closed'
  };
  return labels[status] || status;
}

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position: fixed; bottom: 1rem; right: 1rem; z-index: 1000;';
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.cssText = `
    background: ${type === 'warning' ? '#f59e0b' : '#3b82f6'};
    color: white;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-top: 0.5rem;
    animation: slide-in 0.3s ease-out;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'fade-out 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ================== Drag and Drop ==================

function initDragAndDrop() {
  const taskCards = document.querySelectorAll('.task-card');
  const taskLists = document.querySelectorAll('.task-list');
  
  taskCards.forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
  });
  
  taskLists.forEach(list => {
    list.addEventListener('dragover', handleDragOver);
    list.addEventListener('dragleave', handleDragLeave);
    list.addEventListener('drop', handleDrop);
  });
}

let draggedCard = null;

function handleDragStart(e) {
  draggedCard = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.dataset.id);
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  document.querySelectorAll('.task-list').forEach(list => {
    list.classList.remove('drag-over');
  });
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  this.classList.add('drag-over');
}

function handleDragLeave(e) {
  this.classList.remove('drag-over');
}

async function handleDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over');
  
  const taskId = e.dataTransfer.getData('text/plain');
  const newStatus = this.dataset.status;
  
  if (draggedCard) {
    // Optimistically move the card
    this.appendChild(draggedCard);
    
    // Update via API
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      
      if (!response.ok) {
        throw new Error('Failed to update task');
      }
      
      // Update task count badges
      updateTaskCounts();
    } catch (error) {
      console.error('Error updating task:', error);
      // Reload page to restore correct state
      location.reload();
    }
  }
}

function updateTaskCounts() {
  document.querySelectorAll('.column').forEach(column => {
    const status = column.dataset.status;
    const count = column.querySelectorAll('.task-card').length;
    column.querySelector('.task-count').textContent = count;
  });
}

// ================== Modal ==================

let currentTaskId = null;

function initModal() {
  const modal = document.getElementById('taskModal');
  const addBtn = document.getElementById('addTaskBtn');
  const closeBtn = modal.querySelector('.close');
  const form = document.getElementById('taskForm');
  const deleteBtn = document.getElementById('deleteTaskBtn');
  
  addBtn.addEventListener('click', () => openModal());
  closeBtn.addEventListener('click', () => closeModal());
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  
  form.addEventListener('submit', handleFormSubmit);
  deleteBtn.addEventListener('click', handleDelete);
  
  // Card click to edit
  document.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!e.target.classList.contains('task-card')) return;
      openModal(card.dataset.id);
    });
    card.addEventListener('dblclick', () => {
      openModal(card.dataset.id);
    });
  });
  
  // Tab switching for comments/history
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      
      // Update button states
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update tab content visibility
      document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
        tab.style.display = 'none';
      });
      
      const targetTab = document.getElementById(tabName + 'Tab');
      if (targetTab) {
        targetTab.classList.add('active');
        targetTab.style.display = 'block';
      }
    });
  });
}

async function openModal(taskId = null) {
  const modal = document.getElementById('taskModal');
  const title = document.getElementById('modalTitle');
  const form = document.getElementById('taskForm');
  const deleteBtn = document.getElementById('deleteTaskBtn');
  const commentsSection = document.getElementById('commentsSection');
  
  form.reset();
  document.getElementById('taskId').value = '';
  currentTaskId = taskId;
  
  // Reset tabs to comments
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
    tab.style.display = 'none';
  });
  document.querySelector('.tab-btn[data-tab="comments"]')?.classList.add('active');
  const commentsTab = document.getElementById('commentsTab');
  if (commentsTab) {
    commentsTab.classList.add('active');
    commentsTab.style.display = 'block';
  }
  
  const attachmentsSection = document.getElementById('attachmentsSection');
  
  if (taskId) {
    // Edit mode
    title.textContent = 'Edit Task';
    deleteBtn.style.display = 'block';
    commentsSection.style.display = 'block';
    if (attachmentsSection) attachmentsSection.style.display = 'block';
    
    try {
      const response = await fetch(`/api/tasks/${taskId}`);
      const task = await response.json();
      
      document.getElementById('taskId').value = task._id;
      document.getElementById('taskName').value = task.name;
      document.getElementById('taskDescription').value = task.description || '';
      const typeSelect = document.getElementById('taskType');
      if (typeSelect) typeSelect.value = task.type || 'story';
      document.getElementById('taskPriority').value = task.priority || 3;
      document.getElementById('taskComplexity').value = task.complexity || 3;
      document.getElementById('taskStatus').value = task.status || 'backlog';
      document.getElementById('taskAssignee').value = task.assignee || '';
      document.getElementById('taskRelease').value = task.release || '';
      
      // Render comments
      renderComments(task.comments || []);
      
      // Render history
      renderHistory(task.history || []);
      
      // Render attachments
      renderAttachments(task.attachments || []);
    } catch (error) {
      console.error('Error loading task:', error);
    }
  } else {
    // Create mode
    title.textContent = 'New Task';
    deleteBtn.style.display = 'none';
    commentsSection.style.display = 'none';
    if (attachmentsSection) attachmentsSection.style.display = 'none';
  }
  
  modal.classList.add('show');
}

function closeModal() {
  const modal = document.getElementById('taskModal');
  modal.classList.remove('show');
  currentTaskId = null;
}

async function handleFormSubmit(e) {
  e.preventDefault();
  
  const taskId = document.getElementById('taskId').value;
  const boardId = document.getElementById('boardId').value;
  
  const typeSelect = document.getElementById('taskType');
  const taskData = {
    boardId,
    type: typeSelect ? typeSelect.value : 'story',
    name: document.getElementById('taskName').value,
    description: document.getElementById('taskDescription').value,
    priority: document.getElementById('taskPriority').value,
    complexity: document.getElementById('taskComplexity').value,
    status: document.getElementById('taskStatus').value,
    assignee: document.getElementById('taskAssignee').value || null,
    release: document.getElementById('taskRelease').value || null
  };
  
  try {
    const url = taskId ? `/api/tasks/${taskId}` : '/api/tasks';
    const method = taskId ? 'PUT' : 'POST';
    
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskData)
    });
    
    if (!response.ok) {
      throw new Error('Failed to save task');
    }
    
    closeModal();
    location.reload();
  } catch (error) {
    console.error('Error saving task:', error);
    alert('Failed to save task. Please try again.');
  }
}

async function handleDelete() {
  const taskId = document.getElementById('taskId').value;
  
  if (!taskId || !confirm('Are you sure you want to delete this task?')) {
    return;
  }
  
  try {
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Failed to delete task');
    }
    
    closeModal();
    location.reload();
  } catch (error) {
    console.error('Error deleting task:', error);
    alert('Failed to delete task. Please try again.');
  }
}

// ================== Comments ==================

function initComments() {
  const addCommentBtn = document.getElementById('addCommentBtn');
  if (addCommentBtn) {
    addCommentBtn.addEventListener('click', handleAddComment);
  }
  
  // Enter key to submit comment
  const commentInput = document.getElementById('newComment');
  if (commentInput) {
    commentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        handleAddComment();
      }
    });
  }
}

function renderComments(comments) {
  const container = document.getElementById('commentsList');
  if (!container) return;
  
  if (comments.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.9rem;">No comments yet.</p>';
    return;
  }
  
  container.innerHTML = comments.map(comment => {
    // Apply escapeHtml first, then highlight mentions, then linkify ticket numbers
    const text = linkifyTicketNumbers(highlightMentions(escapeHtml(comment.text)));
    const time = formatTime(comment.timestamp);
    return `
      <div class="comment">
        <div class="comment-header">
          <span class="comment-author">${escapeHtml(comment.authorName || comment.author)}</span>
          <span class="comment-time">${time}</span>
        </div>
        <div class="comment-text">${text}</div>
      </div>
    `;
  }).join('');
  
  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function highlightMentions(text) {
  return text.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
}

// Convert ticket numbers (MNS-XX) to clickable links
function linkifyTicketNumbers(text) {
  return text.replace(/\b(MNS-\d+)\b/gi, (match, ticketNum) => {
    return `<a href="#" class="ticket-link" data-ticket="${ticketNum.toUpperCase()}" onclick="openModalByTicketNumber('${ticketNum.toUpperCase()}'); return false;">${match}</a>`;
  });
}

// Open modal by ticket number (e.g., MNS-22)
async function openModalByTicketNumber(ticketNumber) {
  try {
    const response = await fetch(`/api/tasks/by-ticket/${encodeURIComponent(ticketNumber)}`);
    if (!response.ok) {
      if (response.status === 404) {
        showToast(`Ticket ${ticketNumber} not found`, 'warning');
        return;
      }
      throw new Error('Failed to load task');
    }
    const task = await response.json();
    openModal(task._id);
  } catch (error) {
    console.error('Error loading task by ticket number:', error);
    showToast(`Could not load ${ticketNumber}`, 'warning');
  }
}

function renderHistory(history) {
  const container = document.getElementById('historyList');
  if (!container) return;
  
  if (history.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.8rem;">No history.</p>';
    return;
  }
  
  // Reverse to show newest first
  const reversed = [...history].reverse();
  
  container.innerHTML = reversed.slice(0, 10).map(entry => {
    const time = formatTime(entry.timestamp);
    return `
      <div class="history-item">
        <span class="history-user">${escapeHtml(entry.user)}</span>
        <span class="history-action">${escapeHtml(entry.details)}</span>
        <span class="history-time">${time}</span>
      </div>
    `;
  }).join('');
}

async function handleAddComment() {
  const input = document.getElementById('newComment');
  const text = input.value.trim();
  
  if (!text || !currentTaskId) return;
  
  try {
    const response = await fetch(`/api/tasks/${currentTaskId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    
    if (!response.ok) {
      throw new Error('Failed to add comment');
    }
    
    // Clear input and refresh comments
    input.value = '';
    
    // Reload task to get updated comments
    const taskResponse = await fetch(`/api/tasks/${currentTaskId}`);
    const task = await taskResponse.json();
    renderComments(task.comments || []);
    renderHistory(task.history || []);
    
  } catch (error) {
    console.error('Error adding comment:', error);
    alert('Failed to add comment. Please try again.');
  }
}

// ================== Attachments ==================

function initAttachments() {
  const uploadBtn = document.getElementById('uploadAttachmentBtn');
  const fileInput = document.getElementById('attachmentInput');
  
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileUpload);
  }
}

async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file || !currentTaskId) return;
  
  const statusEl = document.getElementById('uploadStatus');
  statusEl.textContent = 'Uploading...';
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch(`/api/tasks/${currentTaskId}/attachments`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error('Upload failed');
    }
    
    const attachment = await response.json();
    statusEl.textContent = '✓ Uploaded';
    setTimeout(() => statusEl.textContent = '', 2000);
    
    // Refresh attachments list
    const taskResponse = await fetch(`/api/tasks/${currentTaskId}`);
    const task = await taskResponse.json();
    renderAttachments(task.attachments || []);
    
  } catch (error) {
    console.error('Upload error:', error);
    statusEl.textContent = '✗ Failed';
    setTimeout(() => statusEl.textContent = '', 3000);
  }
  
  // Clear input
  e.target.value = '';
}

function renderAttachments(attachments) {
  const container = document.getElementById('attachmentsList');
  if (!container) return;
  
  if (attachments.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.85rem;">No attachments yet.</p>';
    return;
  }
  
  container.innerHTML = attachments.map(att => {
    const isImage = att.mimetype?.startsWith('image/');
    const sizeKB = Math.round(att.size / 1024);
    
    return `
      <div class="attachment-item" data-id="${att.id}">
        ${isImage ? `<img src="${att.url}" alt="${escapeHtml(att.originalName)}" class="attachment-thumb">` : '📄'}
        <a href="${att.url}" target="_blank" class="attachment-name">${escapeHtml(att.originalName)}</a>
        <span class="attachment-size">${sizeKB}KB</span>
        <button type="button" class="btn-delete-attachment" onclick="deleteAttachment('${att.id}')">✕</button>
      </div>
    `;
  }).join('');
}

async function deleteAttachment(attachmentId) {
  if (!currentTaskId || !confirm('Delete this attachment?')) return;
  
  try {
    const response = await fetch(`/api/tasks/${currentTaskId}/attachments/${attachmentId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Delete failed');
    }
    
    // Refresh attachments
    const taskResponse = await fetch(`/api/tasks/${currentTaskId}`);
    const task = await taskResponse.json();
    renderAttachments(task.attachments || []);
    
  } catch (error) {
    console.error('Delete error:', error);
    alert('Failed to delete attachment.');
  }
}

// ================== Utilities ==================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  
  return date.toLocaleDateString();
}

// ================== Backlog View ==================

function initStatusSelects() {
  document.querySelectorAll('.status-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      const taskId = e.target.dataset.taskId;
      const newStatus = e.target.value;
      
      try {
        const response = await fetch(`/api/tasks/${taskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        
        if (!response.ok) {
          throw new Error('Failed to update status');
        }
        
        // Update row styling
        const row = e.target.closest('tr');
        row.className = `status-${newStatus}`;
      } catch (error) {
        console.error('Error updating status:', error);
        location.reload();
      }
    });
  });
}

function initEditButtons() {
  document.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      openModal(btn.dataset.id);
    });
  });
}
