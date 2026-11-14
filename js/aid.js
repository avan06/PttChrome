/* Native PTT AID parsing, link generation and in-client navigation. */
pttchrome.AID = {
  alphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_',

  toHash: function(number) {
    number = Number(number);
    if (!isFinite(number) || number < 0) {
      throw new Error('Invalid non-negative number');
    }
    number = Math.floor(number);
    var result = '';
    do {
      result = this.alphabet.charAt(number % 64) + result;
      number = Math.floor(number / 64);
    } while (number > 0);
    return result;
  },

  toNumber: function(hash) {
    if (!hash || !/^[0-9A-Za-z_-]+$/.test(hash)) {
      throw new Error('Invalid AID hash');
    }
    var result = 0;
    for (var i = 0; i < hash.length; ++i) {
      result = result * 64 + this.alphabet.indexOf(hash.charAt(i));
    }
    return result;
  },

  encodeArticleName: function(name) {
    var match = /(?:^|\/)(?:([0-9A-Za-z_-]+)\/)?M\.(\d+)\.A\.([0-9A-Fa-f]{3})(?:\.html)?$/.exec(name);
    if (!match) {
      throw new Error('Invalid PTT article name');
    }
    var aid = this.toHash(match[2]) + this.toHash(parseInt(match[3], 16));
    while (aid.length < 8) {
      aid = aid.substr(0, 6) + '0' + aid.substr(6);
    }
    return {
      aid: aid,
      board: match[1] || null,
      text: '#' + aid + (match[1] ? ' (' + match[1] + ')' : '')
    };
  },

  decode: function(aid) {
    aid = String(aid || '').replace(/^#/, '');
    if (!/^[0-9A-Za-z_-]{8}$/.test(aid)) {
      throw new Error('Invalid AID');
    }
    var timestamp = this.toNumber(aid.substr(0, 6));
    var random = this.toNumber(aid.substr(6, 2)).toString(16).toUpperCase();
    while (random.length < 3) {
      random = '0' + random;
    }
    return {
      aid: aid,
      timestamp: timestamp,
      random: random,
      articleName: 'M.' + timestamp + '.A.' + random
    };
  },

  webUrl: function(board, aid) {
    if (!/^[0-9A-Za-z_-]+$/.test(board || '')) {
      return '';
    }
    return 'https://www.ptt.cc/bbs/' + encodeURIComponent(board) + '/' +
      this.decode(aid).articleName + '.html';
  },

  findAll: function(text) {
    var pattern = /(^|[^0-9A-Za-z_\-\/'"<>;])#([0-9A-Za-z_-]{8})(?:\s+\(([0-9A-Za-z_-]+)\))?/g;
    var results = [];
    var match;
    while ((match = pattern.exec(text)) !== null) {
      var prefixLength = match[1].length;
      results.push({
        index: match.index + prefixLength,
        length: match[0].length - prefixLength,
        aid: match[2],
        board: match[3] || null,
        text: match[0].substr(prefixLength)
      });
    }
    return results;
  }
};

pttchrome.AIDManager = function(app) {
  this.app = app;
  this.clickHandler = this.onClick.bind(this);
  app.BBSWin.addEventListener('click', this.clickHandler, true);
};

pttchrome.AIDManager.prototype.createArticleContext = function(container) {
  var context = {
    articleBoard: this.app.buf.currentBoard || null,
    transcribedFromBoard: null,
    hasTranscriber: false
  };
  if (!container) {
    return context;
  }

  var text = container.textContent || '';
  var articleHeader = /(?:^|\n)作者\s+\S+\s+看板\s+([0-9A-Za-z_-]+)/.exec(text);
  if (articleHeader) {
    context.articleBoard = articleHeader[1];
  }
  context.hasTranscriber = /※\s*轉錄者\s*:/.test(text);
  return context;
};

pttchrome.AIDManager.prototype.updateTranscriptionContext = function(context, rowText) {
  var transcribed = /本文轉錄自\s+([0-9A-Za-z_-]+)\s+看板/.exec(rowText);
  if (transcribed) {
    context.transcribedFromBoard = transcribed[1];
  }
};

pttchrome.AIDManager.prototype.resolveBoard = function(context, explicitBoard) {
  if (explicitBoard) {
    return explicitBoard;
  }
  // A repost with a PTT transcriber belongs to the current signed article;
  // otherwise AIDs following "本文轉錄自" belong to the source board.
  if (context.hasTranscriber) {
    return context.articleBoard;
  }
  return context.transcribedFromBoard || context.articleBoard || null;
};

pttchrome.AIDManager.prototype.collectTextNodes = function(row) {
  var nodes = [];
  var walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, null, false);
  var node;
  var offset = 0;
  while ((node = walker.nextNode())) {
    if (node.parentNode && node.parentNode.tagName === 'A') {
      offset += node.nodeValue.length;
      continue;
    }
    nodes.push({node: node, start: offset, end: offset + node.nodeValue.length});
    offset += node.nodeValue.length;
  }
  return nodes;
};

pttchrome.AIDManager.prototype.findBoundary = function(nodes, offset, isEnd) {
  for (var i = 0; i < nodes.length; ++i) {
    if (offset < nodes[i].end || (isEnd && offset === nodes[i].end)) {
      return {node: nodes[i].node, offset: offset - nodes[i].start};
    }
  }
  return null;
};

pttchrome.AIDManager.prototype.linkifyRow = function(row, context) {
  if (!row || row.querySelector('a[data-ptt-aid]')) {
    return;
  }
  var rowText = row.textContent || '';
  this.updateTranscriptionContext(context, rowText);
  var matches = pttchrome.AID.findAll(rowText);
  if (!matches.length) {
    return;
  }
  var nodes = this.collectTextNodes(row);
  for (var i = matches.length - 1; i >= 0; --i) {
    var match = matches[i];
    var board = this.resolveBoard(context, match.board);
    if (!board) {
      continue;
    }
    var start = this.findBoundary(nodes, match.index, false);
    var end = this.findBoundary(nodes, match.index + match.length, true);
    if (!start || !end) {
      continue;
    }
    var range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    var link = document.createElement('a');
    link.setAttribute('data-ptt-aid', match.aid);
    link.setAttribute('data-ptt-board', board);
    link.setAttribute('href', pttchrome.AID.webUrl(board, match.aid));
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noreferrer');
    link.setAttribute('title', '在 PttChrome 開啟 ' + board + ' #' + match.aid);
    link.appendChild(range.extractContents());
    range.insertNode(link);
  }
};

pttchrome.AIDManager.prototype.linkify = function(container) {
  if (!container || this.app.buf.pageState !== 3) {
    return;
  }
  var rows = container.querySelectorAll('span[type="bbsrow"]');
  var context = this.createArticleContext(container);
  for (var i = 0; i < rows.length; ++i) {
    this.linkifyRow(rows[i], context);
  }
};

pttchrome.AIDManager.prototype.onClick = function(event) {
  var target = event.target;
  while (target && target !== this.app.BBSWin) {
    if (target.getAttribute && target.getAttribute('data-ptt-aid')) {
      // Only replace an ordinary primary-button activation. Modified clicks,
      // middle clicks, and PttChrome's context-menu Ctrl-click must retain the
      // anchor's native new-tab/new-window behavior.
      if (!this.app.autoGotoAIDArticle || event.button !== 0 ||
          event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.app.navigateToAid(
        target.getAttribute('data-ptt-board'),
        target.getAttribute('data-ptt-aid')
      );
      return;
    }
    target = target.parentNode;
  }
};
