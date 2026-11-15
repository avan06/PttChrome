if (typeof pttchrome === 'undefined') {
  throw new Error('Global "pttchrome" object does not exist.');
}

/**
 * Hides the repeated author id and colon on consecutive push rows.
 * This runs from TermView's native render lifecycle, so it does not poll the
 * page or observe DOM mutations like the legacy UserScript implementation.
 */
pttchrome.ArticleAuthorMerge = function(app) {
  this.app = app;
};

pttchrome.ArticleAuthorMerge.prototype.isEnabled = function() {
  return !!(this.app.pref &&
      this.app.pref.get('mergeContinuousPushAuthor'));
};

pttchrome.ArticleAuthorMerge.prototype.getUserId = function(row) {
  var classes = (row.className || '').split(/\s+/);
  for (var i = 0; i < classes.length; ++i) {
    if (classes[i].indexOf('blu_') === 0) {
      return classes[i].substring(4).toLowerCase();
    }
  }
  return '';
};

pttchrome.ArticleAuthorMerge.prototype.maskRepeatedAuthor = function(row, userId) {
  var spans = row.querySelectorAll('span');
  var authorSpan = null;
  var authorIndex = -1;

  for (var i = 0; i < spans.length; ++i) {
    if ((spans[i].textContent || '').trim().toLowerCase() === userId) {
      authorSpan = spans[i];
      authorIndex = i;
      break;
    }
  }

  // ArticleFloor recreates every floor node on each incremental redraw.
  // A row whose author was masked by an earlier pass no longer has a span whose
  // text matches userId, so the floor must be hidden before authorSpan's guard.
  var floorNode = row.querySelector('[data-ptt-floor]');
  if (floorNode) {
    floorNode.style.visibility = 'hidden';
  }

  if (!authorSpan) {
    return;
  }

  authorSpan.textContent = authorSpan.textContent.replace(/\S/g, ' ');

  for (var j = authorIndex + 1; j < spans.length; ++j) {
    if ((spans[j].textContent || '').indexOf(':') !== -1) {
      spans[j].textContent = spans[j].textContent.replace(':', ' ');
      break;
    }
  }
};

pttchrome.ArticleAuthorMerge.prototype.update = function(view) {
  if (!view || !view.mainContainer || !view.buf ||
      view.buf.pageState !== 3 || !this.isEnabled()) {
    return;
  }

  var rows = view.mainContainer.querySelectorAll('span[type="bbsrow"]');
  var previousUserId = '';

  for (var i = 0; i < rows.length; ++i) {
    var userId = this.getUserId(rows[i]);
    if (!userId) {
      continue;
    }
    if (previousUserId === userId) {
      this.maskRepeatedAuthor(rows[i], userId);
    }
    previousUserId = userId;
  }
};
