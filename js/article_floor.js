if (typeof pttchrome === 'undefined') {
  throw new Error('Global "pttchrome" object does not exist.');
}

/**
 * Adds push floor numbers as part of TermView's render lifecycle.
 * Normal mode uses overlapping visible push rows as anchors, because PTT
 * exposes a sliding 23-row window rather than independent non-overlapping pages.
 */
pttchrome.ArticleFloor = function(app) {
  this.app = app;
  this.previousRows = [];
  this.currentPage = null;
  this.pageSnapshots = {};
};

pttchrome.ArticleFloor.prototype.reset = function() {
  this.previousRows = [];
  this.currentPage = null;
  this.pageSnapshots = {};
};

pttchrome.ArticleFloor.prototype.isEnabled = function() {
  return !!(this.app.pref &&
      this.app.pref.get('enableArticleFloorNumber'));
};

pttchrome.ArticleFloor.prototype.isPushRow = function(row) {
  return /(?:^|\s)blu_[^\s]+(?:\s|$)/.test(row.className || '');
};

pttchrome.ArticleFloor.prototype.getPageInfo = function(view) {
  if (!view || !view.buf || typeof ''.parseStatusRow !== 'function') {
    return null;
  }
  return view.buf.getRowText(23, 0, view.buf.cols).parseStatusRow();
};

pttchrome.ArticleFloor.prototype.getSignature = function(row) {
  var text = row.textContent || '';
  return (row.className || '') + '\n' + text.replace(/\s+/g, ' ').trim();
};

pttchrome.ArticleFloor.prototype.findBestAnchor = function(currentRows) {
  var best = null;
  var previous = this.previousRows;

  for (var previousIndex = 0; previousIndex < previous.length;
      ++previousIndex) {
    for (var currentIndex = 0; currentIndex < currentRows.length;
        ++currentIndex) {
      var length = 0;
      while (previousIndex + length < previous.length &&
          currentIndex + length < currentRows.length &&
          previous[previousIndex + length].signature ===
              currentRows[currentIndex + length].signature) {
        ++length;
      }

      if (length > 0 && (!best || length > best.length)) {
        best = {
          previousIndex: previousIndex,
          currentIndex: currentIndex,
          length: length,
          floor: previous[previousIndex].floor
        };
      }
    }
  }

  return best;
};

pttchrome.ArticleFloor.prototype.createFloorNode = function(floor) {
  var node = document.createElement('div');
  node.className = 'pttArticleFloor';
  node.setAttribute('data-ptt-floor', floor);
  node.textContent = floor;
  node.style.cssText =
      'float:left;' +
      'margin-left:2.2%;' +
      'height:0;' +
      'width:1.5em;' +
      'font-size:0.4em;' +
      'font-weight:bold;' +
      'line-height:1;' +
      'text-align:right;';
  return node;
};

pttchrome.ArticleFloor.prototype.update = function(view) {
  if (!view || !view.mainContainer) {
    return;
  }

  var oldFloors = view.mainContainer.querySelectorAll('[data-ptt-floor]');
  var i;
  for (i = 0; i < oldFloors.length; ++i) {
    oldFloors[i].parentNode.removeChild(oldFloors[i]);
  }

  if (!this.isEnabled() || !view.buf || view.buf.pageState !== 3) {
    this.reset();
    return;
  }

  var allRows = view.mainContainer.querySelectorAll('span[type="bbsrow"]');
  var pushRows = [];
  for (i = 0; i < allRows.length; ++i) {
    if (this.isPushRow(allRows[i])) {
      pushRows.push({
        element: allRows[i],
        signature: this.getSignature(allRows[i]),
        floor: 0
      });
    }
  }

  if (view.useEasyReadingMode) {
    for (i = 0; i < pushRows.length; ++i) {
      pushRows[i].floor = i + 1;
      pushRows[i].element.insertBefore(
          this.createFloorNode(pushRows[i].floor),
          pushRows[i].element.firstChild);
    }
    this.previousRows = pushRows;
    return;
  }

  var pageInfo = this.getPageInfo(view);
  var pageIndex = pageInfo ? pageInfo.pageIndex : null;
  var anchor = this.findBestAnchor(pushRows);
  var firstFloor = 1;

  if (anchor) {
    // The matched row keeps exactly the same floor. Rows newly exposed above
    // or below are numbered relative to that stable anchor.
    firstFloor = anchor.floor - anchor.currentIndex;
  } else if (pageIndex !== null && this.pageSnapshots[pageIndex]) {
    firstFloor = this.pageSnapshots[pageIndex].firstFloor;
  } else if (this.previousRows.length && pageIndex !== null &&
      this.currentPage !== null && pageIndex === this.currentPage + 1) {
    // Fallback for an unusual redraw with no textual overlap.
    firstFloor = this.previousRows[this.previousRows.length - 1].floor + 1;
  }

  if (firstFloor < 1) {
    firstFloor = 1;
  }

  for (i = 0; i < pushRows.length; ++i) {
    pushRows[i].floor = firstFloor + i;
    pushRows[i].element.insertBefore(
        this.createFloorNode(pushRows[i].floor),
        pushRows[i].element.firstChild);
  }

  if (pageIndex !== null && pushRows.length) {
    this.pageSnapshots[pageIndex] = {
      firstFloor: pushRows[0].floor,
      lastFloor: pushRows[pushRows.length - 1].floor,
      firstSignature: pushRows[0].signature,
      lastSignature: pushRows[pushRows.length - 1].signature
    };
    this.currentPage = pageIndex;
  }

  this.previousRows = pushRows;
};
