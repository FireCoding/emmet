/**
 * HTML pair matching (balancing) actions
 * @constructor
 */
if (typeof module === 'object' && typeof define !== 'function') {
	var define = function (factory) {
		module.exports = factory(require, exports, module);
	};
}

define(function(require, exports, module) {
	var _ = require('lodash');
	var htmlMatcher = require('../assets/htmlMatcher');
	var utils = require('../utils/common');
	var editorUtils = require('../utils/editor');
	var range = require('../assets/range');
	var cssEditTree = require('../editTree/css');
	var lastMatch = null;

	function balanceHTML(editor, direction) {
		var info = editorUtils.outputInfo(editor);
		var content = info.content;
		var sel = range(editor.getSelectionRange());
		
		// validate previous match
		if (lastMatch && !lastMatch.range.equal(sel)) {
			lastMatch = null;
		}
		
		if (lastMatch && sel.length()) {
			if (direction == 'in') {
				// user has previously selected tag and wants to move inward
				if (lastMatch.type == 'tag' && !lastMatch.close) {
					// unary tag was selected, can't move inward
					return false;
				} else {
					if (lastMatch.range.equal(lastMatch.outerRange)) {
						lastMatch.range = lastMatch.innerRange;
					} else {
						var narrowed = utils.narrowToNonSpace(content, lastMatch.innerRange);
						lastMatch = htmlMatcher.find(content, narrowed.start + 1);
						if (lastMatch && lastMatch.range.equal(sel) && lastMatch.outerRange.equal(sel)) {
							lastMatch.range = lastMatch.innerRange;
						}
					}
				}
			} else {
				if (
					!lastMatch.innerRange.equal(lastMatch.outerRange) 
					&& lastMatch.range.equal(lastMatch.innerRange) 
					&& sel.equal(lastMatch.range)) {
					lastMatch.range = lastMatch.outerRange;
				} else {
					lastMatch = htmlMatcher.find(content, sel.start);
					if (lastMatch && lastMatch.range.equal(sel) && lastMatch.innerRange.equal(sel)) {
						lastMatch.range = lastMatch.outerRange;
					}
				}
			}
		} else {
			lastMatch = htmlMatcher.find(content, sel.start);
		}
		
		if (lastMatch && !lastMatch.range.equal(sel)) {
			editor.createSelection(lastMatch.range.start, lastMatch.range.end);
			return true;
		}
		
		lastMatch = null;
		return false;
	}

	/**
	 * Returns all possible selection ranges for givrn caret position
	 * @param  {String} content CSS content
	 * @param  {Number} pos     Caret position(where to start searching)
	 * @return {Array}
	 */
	function getCSSRanges(content, pos) {
		var rule;
		if (_.isString(content)) {
			rule = cssEditTree.parseFromPosition(content, pos, true);
			if (!rule) {
				// try to parse forward
				rule = cssEditTree.parseFromPosition(content, pos, false);
			}
		} else {
			// passed parsed CSS rule
			rule = content;
		}

		if (!rule) {
			return null;
		}

		// find all possible ranges
		var ranges = [rule.range(true)];

		// braces content
		ranges.push(range.create2(ranges[0].start + rule._positions.contentStart, ranges[0].end - 1));

		// real content, e.g. from first property name to
		// last property value
		var items = rule.list();
		if (items.length) {
			ranges.push(range.create2(items[0].namePosition(true), _.last(items).valueRange(true).end));
		}

		var prop = cssEditTree.propertyFromPosition(rule, pos) || items[0];
		if (prop) {
			ranges.push(prop.range(true), prop.valueRange(true));
		}

		// remove empty ranges
		ranges = _.filter(ranges, function(item) {
			return !!item.length;
		});

		return _.uniq(ranges, function(item) {
			return item.valueOf();
		});
	}

	function balanceCSS(editor, direction) {
		var info = editorUtils.outputInfo(editor);
		var content = info.content;
		var sel = range(editor.getSelectionRange());

		var ranges = getCSSRanges(info.content, sel.start);
		if (!ranges && sel.length()) {
			// possible reason: user has already selected
			// CSS rule from last match
			try {
				var rule = cssEditTree.parse(sel.substring(info.content), {
					offset: sel.start
				});
				var ranges = getCSSRanges(rule, sel.start);
			} catch(e) {}
		}

		if (!ranges) {
			return false;
		}

		ranges = ranges.sort(function(a, b) {
			return a.length() - b.length();
		});

		// edge case: find match that equals current selection,
		// in case if user moves inward after selecting full CSS rule
		var bestMatch = _.find(ranges, function(r) {
			return r.equal(sel);
		});

		if (!bestMatch) {
			bestMatch = _.find(ranges, function(r) {
				return r.cmp(sel.start, 'lt', 'gte');
			});
		}

		if (!bestMatch) {
			return false;
		}

		// is best match equals to current selection, move index
		// one position up or down, depending on diraction
		var bestMatchIx = _.indexOf(ranges, bestMatch);
		if (bestMatch.equal(sel)) {
			bestMatchIx += direction == 'out' ? 1 : -1;
		}

		if (bestMatchIx < 0 || bestMatchIx >= ranges.length) {
			return false;
		}

		bestMatch = ranges[bestMatchIx];
		editor.createSelection(bestMatch.start, bestMatch.end);
		return true;
	}
	
	return {
		/**
		 * Find and select HTML tag pair
		 * @param {IEmmetEditor} editor Editor instance
		 * @param {String} direction Direction of pair matching: 'in' or 'out'. 
		 * Default is 'out'
		 */
		balance: function(editor, direction) {
			direction = String((direction || 'out').toLowerCase());
			var info = editorUtils.outputInfo(editor);
			if (info.syntax == 'css') {
				return balanceCSS(editor, direction);
			}
			
			return balanceHTML(editor, direction);
		},

		balanceInwardAction: function(editor) {
			return this.balance(editor, 'in');
		},

		balanceOutwardAction: function(editor) {
			return this.balance(editor, 'out');	
		},

		/**
		 * Moves caret to matching opening or closing tag
		 * @param {IEmmetEditor} editor
		 */
		goToMatchingPairAction: function(editor) {
			var content = String(editor.getContent());
			var caretPos = editor.getCaretPos();
			
			if (content.charAt(caretPos) == '<') 
				// looks like caret is outside of tag pair  
				caretPos++;
				
			var tag = htmlMatcher.tag(content, caretPos);
			if (tag && tag.close) { // exclude unary tags
				if (tag.open.range.inside(caretPos)) {
					editor.setCaretPos(tag.close.range.start);
				} else {
					editor.setCaretPos(tag.open.range.start);
				}
				
				return true;
			}
			
			return false;
		}
	};
});