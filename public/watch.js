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

  // 从 URL 获取 UUID
  function getUserUUID() {
    var path = window.location.pathname;
    var match = path.match(/\/user\/([^\/]+)/);
    return match ? match[1] : null;
  }

  // 创建消息元素
  function createMessageElement(role, content) {
    var messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + role;

    var contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = content;

    messageDiv.appendChild(contentDiv);
    return messageDiv;
  }

  // 添加消息到界面
  function addMessage(role, content) {
    var messagesContainer = document.getElementById('messages');
    var messageEl = createMessageElement(role, content);
    messagesContainer.appendChild(messageEl);

    // 滚动到底部
    setTimeout(function() {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 100);
  }

  // 显示错误
  function showError(message) {
    var errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);

    setTimeout(function() {
      if (errorDiv.parentNode) {
        errorDiv.parentNode.removeChild(errorDiv);
      }
    }, 3000);
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
                // 选择第一个会话
                switchConversation(conversations[0]);
              } else {
                // 如果没有任何会话，自动创建一个
                createNewConversation();
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
      var button = document.createElement('button');
      button.className = 'conv-item';

      if (currentConversation && conv.id === currentConversation.id) {
        button.className += ' active';
      }

      var titleDiv = document.createElement('div');
      titleDiv.className = 'conv-item-title';
      titleDiv.textContent = conv.title || 'New Chat';

      var timeDiv = document.createElement('div');
      timeDiv.className = 'conv-item-time';
      timeDiv.textContent = formatTime(conv.updatedAt);

      button.appendChild(titleDiv);
      button.appendChild(timeDiv);

      // 使用闭包保存 conv
      (function(c) {
        if (button.addEventListener) {
          button.addEventListener('click', function() {
            switchConversation(c);
          });
        } else if (button.attachEvent) {
          button.attachEvent('onclick', function() {
            switchConversation(c);
          });
        }
      })(conv);

      listEl.appendChild(button);
    }
  }

  // 格式化时间
  function formatTime(timestamp) {
    var date = new Date(timestamp);
    var now = new Date();
    var diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
  }

  // 切换会话
  function switchConversation(conversation) {
    currentConversation = conversation;
    renderConversations();
    loadConversationChats();
    toggleConversations(); // 关闭侧边栏
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
              addMessage(chat.role, chat.content);
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
  function createNewConversation() {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/conversations/' + userUUID, true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var response = JSON.parse(xhr.responseText);
          if (response.success && response.conversation) {
            conversations.unshift(response.conversation);
            switchConversation(response.conversation);
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

  // 删除当前会话
  function deleteCurrentConversation() {
    if (!currentConversation) {
      showError('No active conversation');
      return;
    }

    if (!confirm('Delete this conversation?')) return;

    var xhr = new XMLHttpRequest();
    xhr.open('DELETE', '/api/conversations/' + currentConversation.id, true);

    xhr.onload = function() {
      if (xhr.status === 200) {
        // 从列表中移除
        conversations = conversations.filter(function(c) {
          return c.id !== currentConversation.id;
        });

        currentConversation = null;
        renderConversations();
        document.getElementById('messages').innerHTML = '';

        // 选择第一个会话或创建新的
        if (conversations.length > 0) {
          switchConversation(conversations[0]);
        } else {
          createNewConversation();
        }

        toggleMenu();
      }
    };

    xhr.onerror = function() {
      showError('Failed to delete conversation');
    };

    xhr.send();
  }

  // 切换会话侧边栏
  function toggleConversations() {
    var sidebar = document.getElementById('conversations-sidebar');
    var menu = document.getElementById('menu');
    var selector = document.getElementById('model-selector');

    // 关闭其他面板
    menu.style.display = 'none';
    selector.style.display = 'none';

    var isVisible = sidebar.style.display === 'flex' || sidebar.style.display === 'block';
    sidebar.style.display = isVisible ? 'none' : 'flex';
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
    sidebar.style.display = 'none';

    var isVisible = selector.style.display === 'block';
    selector.style.display = isVisible ? 'none' : 'block';
  }

  // 发送消息
  function sendMessage() {
    if (isLoading) return;

    var inputEl = document.getElementById('input');
    var message = inputEl.value.trim();

    if (!message) return;

    // 添加用户消息到界面
    addMessage('user', message);
    inputEl.value = '';

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
            addMessage('assistant', response.reply);

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
      model: selectedModel ? selectedModel.id : null,
      conversationId: currentConversation ? currentConversation.id : null
    }));
  }

  // 切换菜单
  function toggleMenu() {
    var menu = document.getElementById('menu');
    var selector = document.getElementById('model-selector');
    var sidebar = document.getElementById('conversations-sidebar');

    // 关闭其他面板
    selector.style.display = 'none';
    sidebar.style.display = 'none';

    var isVisible = menu.style.display === 'block';
    menu.style.display = isVisible ? 'none' : 'block';
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
      sendBtn.addEventListener('click', sendMessage);
    } else if (sendBtn.attachEvent) {
      sendBtn.attachEvent('onclick', sendMessage);
    }

    // 加载数据
    loadModels();
    loadConversations();
  }

  // 暴露全局函数供 HTML 使用
  window.toggleMenu = toggleMenu;
  window.toggleModelSelector = toggleModelSelector;
  window.toggleConversations = toggleConversations;
  window.createNewConversation = createNewConversation;
  window.deleteCurrentConversation = deleteCurrentConversation;

  // 页面加载完成后初始化
  if (document.readyState === 'complete') {
    init();
  } else if (window.addEventListener) {
    window.addEventListener('load', init);
  } else if (window.attachEvent) {
    window.attachEvent('onload', init);
  }

})();
