/* ES5 兼容的 Apple Watch Chat 客户端 - 带会话管理 */

(function() {
  'use strict';

  // 全局状态
  var isLoading = false;
  var userUUID = null;
  var models = [];
  var selectedModel = null;
  var conversations = [];
  var currentConversation = null;
  var confirmCallback = null;
  var systemPrompts = [];
  var selectedSystemPrompt = null;

  // 从 URL 获取 UUID
  function getUserUUID() {
    var path = window.location.pathname;
    var match = path.match(/\/user\/([^\/]+)/);
    return match ? match[1] : null;
  }

  // 轻量级 Markdown 解析器
  function parseMarkdown(text) {
    if (!text) return '';

    // 先处理数学公式（在转义 HTML 之前）
    var mathBlocks = [];

    // 处理块级公式 $$...$$
    text = text.replace(/\$\$([^\$]+)\$\$/g, function(match, formula) {
      try {
        var html = window.katex.renderToString(formula.trim(), {
          throwOnError: false,
          displayMode: true
        });
        mathBlocks.push('<div class="math-block">' + html + '</div>');
        return '___MATH_BLOCK_' + (mathBlocks.length - 1) + '___';
      } catch (e) {
        return match;
      }
    });

    // 处理行内公式 $...$
    text = text.replace(/\$([^\$]+)\$/g, function(match, formula) {
      try {
        var html = window.katex.renderToString(formula.trim(), {
          throwOnError: false,
          displayMode: false
        });
        mathBlocks.push(html);
        return '___MATH_BLOCK_' + (mathBlocks.length - 1) + '___';
      } catch (e) {
        return match;
      }
    });

    // 转义 HTML 特殊字符
    var escapeHtml = function(str) {
      return str.replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
    };

    text = escapeHtml(text);

    // 代码块 ```code```
    text = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

    // 行内代码 `code`
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 粗体 **text**
    text = text.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');

    // 斜体 *text*
    text = text.replace(/\*([^\*]+)\*/g, '<em>$1</em>');

    // 标题 # H1, ## H2, ### H3
    text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // 无序列表 - item
    text = text.replace(/^- (.+)$/gm, '<li>$1</li>');
    text = text.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // 有序列表 1. item
    text = text.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // 引用 > text
    text = text.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // 链接 [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // 换行
    text = text.replace(/\n/g, '<br>');

    // 恢复数学公式
    for (var i = 0; i < mathBlocks.length; i++) {
      text = text.replace('___MATH_BLOCK_' + i + '___', mathBlocks[i]);
    }

    return text;
  }

  // 创建消息元素
  function createMessageElement(role, content, showRegenerate, chat) {
    var messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + role;
    messageDiv.setAttribute('data-chat-id', chat.id || '');

    var contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // AI 消息应用 Markdown 渲染
    if (role === 'assistant') {
      contentDiv.innerHTML = parseMarkdown(content);
    } else {
      contentDiv.textContent = content;
    }

    messageDiv.appendChild(contentDiv);

    // 添加元数据（时间和模型）
    if (chat) {
      var metaDiv = document.createElement('div');
      metaDiv.className = 'message-meta';

      var timeText = formatChatTime(chat.timestamp);
      var modelText = chat.modelId ? getModelNameById(chat.modelId) : '';

      if (modelText) {
        metaDiv.textContent = timeText + ' · ' + modelText;
      } else {
        metaDiv.textContent = timeText;
      }

      messageDiv.appendChild(metaDiv);
    }

    // 如果是用户消息，添加操作按钮
    if (role === 'user') {
      var actionsBtn = document.createElement('button');
      actionsBtn.className = 'message-actions-btn';
      actionsBtn.textContent = '⋯';
      actionsBtn.onclick = function(e) {
        e.stopPropagation();
        showMessageActions(chat);
      };
      messageDiv.appendChild(actionsBtn);
    }

    // 如果是 AI 消息且需要显示重新生成按钮
    if (role === 'assistant' && showRegenerate) {
      var regenBtn = document.createElement('button');
      regenBtn.className = 'regenerate-btn';
      regenBtn.textContent = '↻ Regenerate';
      regenBtn.onclick = function() {
        regenerateLastResponse();
      };
      messageDiv.appendChild(regenBtn);
    }

    return messageDiv;
  }

  // 添加消息到界面
  function addMessage(role, content, showRegenerate, chat) {
    var messagesContainer = document.getElementById('messages');
    var messageEl = createMessageElement(role, content, showRegenerate, chat);
    messagesContainer.appendChild(messageEl);

    // 滚动到底部
    setTimeout(function() {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 100);
  }

  // 显示 Toast 通知
  function showToast(message, type) {
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast-' + (type || 'info');
    toast.style.display = 'block';

    setTimeout(function() {
      toast.style.display = 'none';
    }, 3000);
  }

  // 显示错误
  function showError(message) {
    showToast(message, 'error');
  }

  // 显示成功
  function showSuccess(message) {
    showToast(message, 'success');
  }

  // 显示确认对话框
  function showConfirm(message, onConfirm, confirmText) {
    var overlay = document.getElementById('confirm-overlay');
    var messageEl = document.getElementById('confirm-message');
    var okBtn = document.getElementById('confirm-ok');

    messageEl.textContent = message;
    okBtn.textContent = confirmText || 'Confirm';
    confirmCallback = onConfirm;

    overlay.style.display = 'flex';
    setTimeout(function() {
      overlay.classList.add('show');
    }, 10);
  }

  // 隐藏确认对话框
  function hideConfirm() {
    var overlay = document.getElementById('confirm-overlay');
    overlay.classList.remove('show');
    setTimeout(function() {
      overlay.style.display = 'none';
      confirmCallback = null;
    }, 300);
  }

  // 确认对话框 - 确定
  function handleConfirmOk() {
    if (confirmCallback) {
      confirmCallback();
    }
    hideConfirm();
  }

  // 确认对话框 - 取消
  function handleConfirmCancel() {
    hideConfirm();
  }

  // 设置加载状态
  function setLoading(loading) {
    isLoading = loading;
    var loadingEl = document.getElementById('loading');
    var sendBtn = document.getElementById('send');
    var inputEl = document.getElementById('input');

    loadingEl.style.display = loading ? 'block' : 'none';
    sendBtn.disabled = loading;
    inputEl.disabled = loading;
  }

  // 加载会话列表
  function loadConversations() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/conversations/' + userUUID, true);

    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var response = JSON.parse(xhr.responseText);
          if (response.success && response.conversations) {
            conversations = response.conversations;
            renderConversations();

            // 如果没有当前会话
            if (!currentConversation) {
              if (conversations.length > 0) {
                // 选择第一个会话，但不自动关闭侧边栏
                switchConversation(conversations[0], false);
              } else {
                // 如果没有任何会话，自动创建一个（不自动关闭侧边栏）
                createNewConversation(false);
              }
            }
          }
        } catch (e) {
          console.error('Parse error:', e);
        }
      }
    };

    xhr.onerror = function() {
      console.error('Failed to load conversations');
    };

    xhr.send();
  }

  // 渲染会话列表
  function renderConversations() {
    var listEl = document.getElementById('conv-list');
    listEl.innerHTML = '';

    if (conversations.length === 0) {
      var emptyDiv = document.createElement('div');
      emptyDiv.style.padding = '20px';
      emptyDiv.style.textAlign = 'center';
      emptyDiv.style.color = '#86868b';
      emptyDiv.textContent = 'No conversations';
      listEl.appendChild(emptyDiv);
      return;
    }

    for (var i = 0; i < conversations.length; i++) {
      var conv = conversations[i];
      var item = document.createElement('div');
      item.className = 'conv-item';

      if (currentConversation && conv.id === currentConversation.id) {
        item.className += ' active';
      }

      var button = document.createElement('button');
      button.className = 'conv-item-main';

      var titleDiv = document.createElement('div');
      titleDiv.className = 'conv-item-title';
      titleDiv.textContent = conv.title || 'New Chat';

      var timeDiv = document.createElement('div');
      timeDiv.className = 'conv-item-time';
      timeDiv.textContent = formatTime(conv.updatedAt);

      button.appendChild(titleDiv);
      button.appendChild(timeDiv);

      // 删除按钮
      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'conv-item-delete';
      deleteBtn.textContent = '×';

      item.appendChild(button);
      item.appendChild(deleteBtn);

      // 使用闭包保存 conv
      (function(c) {
        // 点击会话主体切换会话
        if (button.addEventListener) {
          button.addEventListener('click', function() {
            switchConversation(c);
          });
        } else if (button.attachEvent) {
          button.attachEvent('onclick', function() {
            switchConversation(c);
          });
        }

        // 点击删除按钮删除会话
        if (deleteBtn.addEventListener) {
          deleteBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            deleteConversation(c.id);
          });
        } else if (deleteBtn.attachEvent) {
          deleteBtn.attachEvent('onclick', function(e) {
            e = e || window.event;
            if (e.stopPropagation) e.stopPropagation();
            e.cancelBubble = true;
            deleteConversation(c.id);
          });
        }
      })(conv);

      listEl.appendChild(item);
    }
  }

  // 格式化聊天时间
  function formatChatTime(timestamp) {
    var date = new Date(timestamp);
    var hours = date.getHours();
    var minutes = date.getMinutes();
    var ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return hours + ':' + minutes + ' ' + ampm;
  }

  // 根据模型ID获取模型名称
  function getModelNameById(modelId) {
    for (var i = 0; i < models.length; i++) {
      if (models[i].id === modelId) {
        return models[i].name;
      }
    }
    return modelId;
  }

  // 显示消息操作菜单
  function showMessageActions(chat) {
    var menu = document.getElementById('message-actions-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'message-actions-menu';
      menu.style.display = 'none';
      document.body.appendChild(menu);
    }

    menu.innerHTML = '';

    var regenerateBtn = document.createElement('button');
    regenerateBtn.className = 'action-menu-item';
    regenerateBtn.textContent = 'Regenerate';
    regenerateBtn.onclick = function() {
      hideMessageActions();
      regenerateWithMessage(chat.content, null);
    };

    var changeModelBtn = document.createElement('button');
    changeModelBtn.className = 'action-menu-item';
    changeModelBtn.textContent = 'Change Model & Regenerate';
    changeModelBtn.onclick = function() {
      hideMessageActions();
      showModelSelectorForRegenerate(chat.content);
    };

    menu.appendChild(regenerateBtn);
    menu.appendChild(changeModelBtn);

    menu.style.display = 'block';
    setTimeout(function() {
      menu.classList.add('show');
    }, 10);
  }

  // 隐藏消息操作菜单
  function hideMessageActions() {
    var menu = document.getElementById('message-actions-menu');
    if (menu) {
      menu.classList.remove('show');
      setTimeout(function() {
        menu.style.display = 'none';
      }, 200);
    }
  }

  // 显示模型选择器用于重新生成
  function showModelSelectorForRegenerate(message) {
    var overlay = document.createElement('div');
    overlay.id = 'model-select-overlay';
    overlay.className = 'select-overlay';

    var dialog = document.createElement('div');
    dialog.className = 'select-dialog';

    var title = document.createElement('div');
    title.className = 'select-title';
    title.textContent = 'Select Model';
    dialog.appendChild(title);

    for (var i = 0; i < models.length; i++) {
      var model = models[i];
      var btn = document.createElement('button');
      btn.className = 'select-item';
      btn.textContent = model.name;

      (function(m) {
        btn.onclick = function() {
          document.body.removeChild(overlay);
          regenerateWithMessage(message, m.id);
        };
      })(model);

      dialog.appendChild(btn);
    }

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    setTimeout(function() {
      overlay.classList.add('show');
    }, 10);

    overlay.onclick = function(e) {
      if (e.target === overlay) {
        overlay.classList.remove('show');
        setTimeout(function() {
          if (overlay.parentNode) {
            document.body.removeChild(overlay);
          }
        }, 300);
      }
    };
  }

  // 用指定消息和模型重新生成
  function regenerateWithMessage(message, modelId) {
    if (isLoading || !currentConversation) return;

    // 移除最后一条 AI 消息
    var messagesContainer = document.getElementById('messages');
    var messages = messagesContainer.getElementsByClassName('message');
    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i].classList.contains('assistant')) {
        messagesContainer.removeChild(messages[i]);
        break;
      }
    }

    sendMessage(message, true, modelId || (selectedModel ? selectedModel.id : null));
  }

  // 切换会话
  function switchConversation(conversation, autoClose) {
    currentConversation = conversation;
    renderConversations();
    loadConversationChats();

    // 只有手动切换时才关闭侧边栏（autoClose !== false）
    if (autoClose !== false) {
      toggleConversations();
    }
  }

  // 格式化会话时间
  function formatTime(timestamp) {
    var date = new Date(timestamp);
    var now = new Date();
    var diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
  }

  // 加载会话的聊天记录
  function loadConversationChats() {
    if (!currentConversation) return;

    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/conversations/' + currentConversation.id + '/chats', true);

    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var response = JSON.parse(xhr.responseText);
          if (response.success && response.chats) {
            var messagesContainer = document.getElementById('messages');
            messagesContainer.innerHTML = '';

            for (var i = 0; i < response.chats.length; i++) {
              var chat = response.chats[i];
              // 只在最后一条 AI 消息上显示重新生成按钮
              var isLastAssistant = (i === response.chats.length - 1 && chat.role === 'assistant');
              addMessage(chat.role, chat.content, isLastAssistant, chat);
            }
          }
        } catch (e) {
          console.error('Parse error:', e);
        }
      }
    };

    xhr.onerror = function() {
      showError('Failed to load chat history');
    };

    xhr.send();
  }

  // 创建新会话
  function createNewConversation(autoClose) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/conversations/' + userUUID, true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var response = JSON.parse(xhr.responseText);
          if (response.success && response.conversation) {
            conversations.unshift(response.conversation);
            switchConversation(response.conversation, autoClose);
          }
        } catch (e) {
          showError('Failed to create conversation');
        }
      }
    };

    xhr.onerror = function() {
      showError('Network error');
    };

    xhr.send(JSON.stringify({ title: 'New Chat' }));
  }

  // 删除会话（通用方法）
  function deleteConversation(conversationId) {
    showConfirm('Delete this conversation?', function() {
      var xhr = new XMLHttpRequest();
      xhr.open('DELETE', '/api/conversations/' + conversationId, true);

      xhr.onload = function() {
        if (xhr.status === 200) {
          // 从列表中移除
          conversations = conversations.filter(function(c) {
            return c.id !== conversationId;
          });

          // 如果删除的是当前会话，需要切换
          if (currentConversation && currentConversation.id === conversationId) {
            currentConversation = null;
            document.getElementById('messages').innerHTML = '';

            // 选择第一个会话或创建新的
            if (conversations.length > 0) {
              switchConversation(conversations[0], false);
            } else {
              createNewConversation(false);
            }
          }

          renderConversations();
          showSuccess('Conversation deleted');
        }
      };

      xhr.onerror = function() {
        showError('Failed to delete conversation');
      };

      xhr.send();
    }, 'Delete');
  }

  // 删除当前会话（从菜单调用）
  function deleteCurrentConversation() {
    if (!currentConversation) {
      showError('No active conversation');
      return;
    }

    deleteConversation(currentConversation.id);
    toggleMenu();
  }

  // 切换会话侧边栏
  function toggleConversations() {
    var sidebar = document.getElementById('conversations-sidebar');
    var menu = document.getElementById('menu');
    var selector = document.getElementById('model-selector');

    // 关闭其他面板
    menu.style.display = 'none';
    menu.classList.remove('show');
    selector.style.display = 'none';
    selector.classList.remove('show');

    var isVisible = sidebar.style.display === 'flex' || sidebar.style.display === 'block';
    if (isVisible) {
      sidebar.classList.remove('show');
      setTimeout(function() {
        sidebar.style.display = 'none';
      }, 300);
    } else {
      sidebar.style.display = 'flex';
      setTimeout(function() {
        sidebar.classList.add('show');
      }, 10);
    }
  }

  // 加载系统提示词
  function loadSystemPrompts() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/system-prompts', true);

    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var response = JSON.parse(xhr.responseText);
          if (response.success && response.presets) {
            systemPrompts = response.presets;
            // 默认选择第一个
            if (systemPrompts.length > 0) {
              selectedSystemPrompt = systemPrompts[0];
            }
          }
        } catch (e) {
          console.error('Parse error:', e);
        }
      }
    };

    xhr.onerror = function() {
      console.error('Failed to load system prompts');
    };

    xhr.send();
  }

  // 显示系统提示词选择器
  function showSystemPromptSelector() {
    toggleMenu(); // 关闭菜单

    var overlay = document.createElement('div');
    overlay.className = 'select-overlay';

    var dialog = document.createElement('div');
    dialog.className = 'select-dialog';

    var title = document.createElement('div');
    title.className = 'select-title';
    title.textContent = 'System Prompt';
    dialog.appendChild(title);

    // 添加 "None" 选项
    var noneBtn = document.createElement('button');
    noneBtn.className = 'select-item';
    noneBtn.textContent = 'None';
    if (!selectedSystemPrompt) {
      noneBtn.className += ' active-select';
    }
    noneBtn.onclick = function() {
      selectedSystemPrompt = null;
      document.body.removeChild(overlay);
      showSuccess('System prompt disabled');
    };
    dialog.appendChild(noneBtn);

    // 添加预设
    for (var i = 0; i < systemPrompts.length; i++) {
      var prompt = systemPrompts[i];
      var btn = document.createElement('button');
      btn.className = 'select-item';
      btn.textContent = prompt.name;

      if (selectedSystemPrompt && prompt.id === selectedSystemPrompt.id) {
        btn.className += ' active-select';
      }

      (function(p) {
        btn.onclick = function() {
          selectedSystemPrompt = p;
          document.body.removeChild(overlay);
          showSuccess('System prompt: ' + p.name);
        };
      })(prompt);

      dialog.appendChild(btn);
    }

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    setTimeout(function() {
      overlay.classList.add('show');
    }, 10);

    overlay.onclick = function(e) {
      if (e.target === overlay) {
        overlay.classList.remove('show');
        setTimeout(function() {
          if (overlay.parentNode) {
            document.body.removeChild(overlay);
          }
        }, 300);
      }
    };
  }

  // 加载模型列表
  function loadModels() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/models', true);

    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var response = JSON.parse(xhr.responseText);
          if (response.success && response.models) {
            models = response.models;

            // 设置默认模型
            var defaultModel = null;
            for (var i = 0; i < models.length; i++) {
              if (models[i].default) {
                defaultModel = models[i];
                break;
              }
            }
            selectedModel = defaultModel || models[0];

            // 更新显示
            updateModelDisplay();
            renderModelList();
          }
        } catch (e) {
          console.error('Parse error:', e);
        }
      }
    };

    xhr.onerror = function() {
      console.error('Failed to load models');
    };

    xhr.send();
  }

  // 更新模型显示
  function updateModelDisplay() {
    var modelNameEl = document.getElementById('model-name');
    if (selectedModel) {
      modelNameEl.textContent = selectedModel.name;
    }
  }

  // 渲染模型列表
  function renderModelList() {
    var listEl = document.getElementById('model-list');
    listEl.innerHTML = '';

    for (var i = 0; i < models.length; i++) {
      var model = models[i];
      var button = document.createElement('button');
      button.className = 'model-item';
      button.textContent = model.name;

      if (selectedModel && model.id === selectedModel.id) {
        button.className += ' active';
      }

      // 使用闭包保存 model
      (function(m) {
        if (button.addEventListener) {
          button.addEventListener('click', function() {
            selectModel(m);
          });
        } else if (button.attachEvent) {
          button.attachEvent('onclick', function() {
            selectModel(m);
          });
        }
      })(model);

      listEl.appendChild(button);
    }
  }

  // 选择模型
  function selectModel(model) {
    selectedModel = model;
    updateModelDisplay();
    renderModelList();
    toggleModelSelector();
  }

  // 切换模型选择器
  function toggleModelSelector() {
    var selector = document.getElementById('model-selector');
    var menu = document.getElementById('menu');
    var sidebar = document.getElementById('conversations-sidebar');

    // 关闭其他面板
    menu.style.display = 'none';
    menu.classList.remove('show');
    sidebar.style.display = 'none';
    sidebar.classList.remove('show');

    var isVisible = selector.style.display === 'block';
    if (isVisible) {
      selector.classList.remove('show');
      setTimeout(function() {
        selector.style.display = 'none';
      }, 300);
    } else {
      selector.style.display = 'block';
      setTimeout(function() {
        selector.classList.add('show');
      }, 10);
    }
  }

  // 发送消息
  function sendMessage(messageToSend, isRegenerate, forceModelId) {
    if (isLoading) return;

    var inputEl = document.getElementById('input');
    // 确保 messageToSend 是字符串类型，防止事件对象被传入
    var message = (typeof messageToSend === 'string' && messageToSend)
                  ? messageToSend
                  : inputEl.value.trim();

    if (!message) return;

    var useModelId = forceModelId || (selectedModel ? selectedModel.id : null);
    var useSystemPromptId = selectedSystemPrompt ? selectedSystemPrompt.id : null;

    // 如果不是重新生成，添加用户消息到界面
    if (!isRegenerate) {
      var tempChat = {
        id: 'temp-' + Date.now(),
        role: 'user',
        content: message,
        modelId: useModelId,
        timestamp: new Date().toISOString()
      };
      addMessage('user', message, false, tempChat);
      inputEl.value = '';
    }

    // 设置加载状态
    setLoading(true);

    // 发送到服务器
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/chat/' + userUUID, true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onload = function() {
      setLoading(false);

      if (xhr.status === 200) {
        try {
          var response = JSON.parse(xhr.responseText);
          if (response.success && response.reply) {
            // 如果是重新生成，移除最后一条 AI 消息（已在 regenerateWithMessage 中处理）

            // 添加新的 AI 回复，显示重新生成按钮
            var aiChat = {
              id: 'temp-ai-' + Date.now(),
              role: 'assistant',
              content: response.reply,
              modelId: useModelId,
              timestamp: new Date().toISOString()
            };
            addMessage('assistant', response.reply, true, aiChat);

            // 如果返回了新的会话ID，更新当前会话
            if (response.conversationId && (!currentConversation || currentConversation.id !== response.conversationId)) {
              loadConversations(); // 重新加载会话列表
            }
          } else {
            showError(response.error || 'Unknown error');
          }
        } catch (e) {
          showError('Parse error');
        }
      } else {
        try {
          var errorResponse = JSON.parse(xhr.responseText);
          showError(errorResponse.error || 'Server error');
        } catch (e) {
          showError('Server error');
        }
      }
    };

    xhr.onerror = function() {
      setLoading(false);
      showError('Network error');
    };

    xhr.send(JSON.stringify({
      message: message,
      model: useModelId,
      conversationId: currentConversation ? currentConversation.id : null,
      systemPromptId: useSystemPromptId
    }));
  }

  // 重新生成最后的回复
  function regenerateLastResponse() {
    if (isLoading || !currentConversation) return;

    // 获取最后一条用户消息
    var messagesContainer = document.getElementById('messages');
    var messages = messagesContainer.getElementsByClassName('message');
    var lastUserMessage = null;

    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i].classList.contains('user')) {
        var contentDiv = messages[i].querySelector('.message-content');
        if (contentDiv) {
          lastUserMessage = contentDiv.textContent;
          break;
        }
      }
    }

    if (lastUserMessage) {
      sendMessage(lastUserMessage, true);
    }
  }

  // 切换菜单
  function toggleMenu() {
    var menu = document.getElementById('menu');
    var selector = document.getElementById('model-selector');
    var sidebar = document.getElementById('conversations-sidebar');

    // 关闭其他面板
    selector.style.display = 'none';
    selector.classList.remove('show');
    sidebar.style.display = 'none';
    sidebar.classList.remove('show');

    var isVisible = menu.style.display === 'block';
    if (isVisible) {
      menu.classList.remove('show');
      setTimeout(function() {
        menu.style.display = 'none';
      }, 200);
    } else {
      menu.style.display = 'block';
      setTimeout(function() {
        menu.classList.add('show');
      }, 10);
    }
  }

  // 回车发送
  function handleKeyPress(e) {
    if (e.keyCode === 13 && !isLoading) {
      sendMessage();
    }
  }

  // 初始化
  function init() {
    userUUID = getUserUUID();

    if (!userUUID) {
      showError('Invalid user URL');
      return;
    }

    // 绑定输入框回车事件
    var inputEl = document.getElementById('input');
    if (inputEl.addEventListener) {
      inputEl.addEventListener('keypress', handleKeyPress);
    } else if (inputEl.attachEvent) {
      inputEl.attachEvent('onkeypress', handleKeyPress);
    }

    // 绑定发送按钮点击事件
    var sendBtn = document.getElementById('send');
    if (sendBtn.addEventListener) {
      sendBtn.addEventListener('click', function() {
        sendMessage();
      });
    } else if (sendBtn.attachEvent) {
      sendBtn.attachEvent('onclick', function() {
        sendMessage();
      });
    }

    // 绑定确认对话框按钮
    var confirmOkBtn = document.getElementById('confirm-ok');
    var confirmCancelBtn = document.getElementById('confirm-cancel');
    if (confirmOkBtn.addEventListener) {
      confirmOkBtn.addEventListener('click', handleConfirmOk);
      confirmCancelBtn.addEventListener('click', handleConfirmCancel);
    } else if (confirmOkBtn.attachEvent) {
      confirmOkBtn.attachEvent('onclick', handleConfirmOk);
      confirmCancelBtn.attachEvent('onclick', handleConfirmCancel);
    }

    // 点击遮罩层关闭确认对话框
    var confirmOverlay = document.getElementById('confirm-overlay');
    if (confirmOverlay.addEventListener) {
      confirmOverlay.addEventListener('click', function(e) {
        if (e.target === confirmOverlay) {
          handleConfirmCancel();
        }
      });
    }

    // 加载数据
    loadModels();
    loadConversations();
    loadSystemPrompts();
  }

  // 暴露全局函数供 HTML 使用
  window.toggleMenu = toggleMenu;
  window.toggleModelSelector = toggleModelSelector;
  window.toggleConversations = toggleConversations;
  window.createNewConversation = createNewConversation;
  window.deleteCurrentConversation = deleteCurrentConversation;
  window.showSystemPromptSelector = showSystemPromptSelector;

  // 页面加载完成后初始化
  if (document.readyState === 'complete') {
    init();
  } else if (window.addEventListener) {
    window.addEventListener('load', init);
  } else if (window.attachEvent) {
    window.attachEvent('onload', init);
  }

})();
