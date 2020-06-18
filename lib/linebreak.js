import font from './font';
import whitespace from './whitespace';
import get_word_width from './measure';
import { Token, Break, LineBreak, SoftHyphen } from './parser';

const re_whitespace = /[\r\n\xA0]+/g;
const subscript_size = 0.7;

// return a font style decl. based on the current token
function get_font (token, basefont) {
  // translate sub/super into scaled text
  if (token.sup) {
    token.baseline = 0.45;
    token.size = subscript_size;
  }
  if (token.sub) {
    token.baseline = -0.3;
    token.size = subscript_size;
  }
  // FIXME: token.italic => token.style = 'italic'
  // FIXME: token.bold => token.weight = 'bold'
  let r = basefont;
  // can shortcut to default obj?
  if (token.style || token.weight ||
      token.baseline || token.color ||
      token.size || token.family) {
    r = font(basefont, token);
  }
  return r;
}

function overflow_line (target_line, target_width, token) {
  let line_width = target_line.reduce((a, d) => a + d.width, 0);
  let last;
  let temp;
  while (line_width + token.width > target_width &&
          target_line.length) {
    last = target_line[target_line.length - 1];
    temp = last.width;
    if (last.width > token.width) {
      // reduce the token while possible
      last.value = last.value.slice(0, -1);
      last.width = get_word_width(last, last.font);
      line_width += last.width;
    }
    else {
      // otherwise remove the token
      target_line.pop();
    }
    line_width -= temp;
  }
  if (target_line[target_line.length - 1] instanceof SoftHyphen) {
    // don't add ellipsis directly after hyphen, it is gross
    target_line.pop();
  }

  // it is possible that the last line is empty, because of LineBreaks
  last = target_line[target_line.length - 1] || last || {};
  token.font = font(token.font, last.bold, last.italic, '');
  token.href = target_line.length ? last.href : null;
  target_line.push(token);
}

export default function linebreak (tokens, opt, f_base) {
  if (!tokens.length) {
    return [];
  }

  const height = opt.height();
  const width = opt.width();

  // fonts
  const f_bold = font(f_base, true, false);

  const max_lines = isFinite(height())
    ? Math.floor(height() / f_base.height)
    : Infinity;
  // skip the work for things what will never show anyway
  if ((!height() && !width(0)) || !max_lines) { return []; }

  let lines = [];
  let index = 0;
  let line_index = 0;
  let line_width = 0;
  const breaks = [];
  let line_breaks = [];
  let last_was_whitespace = false;

  while (index < tokens.length && line_index < max_lines) {
    const token = tokens[index];
    const font_inst = get_font(token, f_base); // don't need this for Break or LineBreak

    token.width = get_word_width(token, font_inst);
    token.font = font_inst;
    token.line = line_index;
    token.whitespace = token.value in whitespace;

    if (!line_width && token.whitespace ||
         last_was_whitespace && token.whitespace) {
      // ignore whitespace at the start of a line
      // ignore repeat whitespace
    }
    else if (token instanceof LineBreak) {
      line_width = 0;
      line_breaks = [];
      breaks.push(index + 1);
      line_index++;
    }
    else if (token instanceof Break || token instanceof SoftHyphen) {
      line_breaks.push({
        index: index,
        width: line_width
      });
    }
    else if (!line_breaks.length ||
              token.whitespace ||
              line_width + token.width < width(line_index)) {
      // normalize whitespace (SVG doesn't "space" \n like HTML does)
      token.value = token.value.replace(re_whitespace, ' ');
      // have space to add things - or no alternative
      line_width += token.width;
    }
    else {
      let break_rep;
      let break_accepted;
      do {
        break_accepted = true;
        break_rep = line_breaks.pop();
        const break_token = tokens[break_rep.index];
        let hyp_width;
        if (break_token instanceof SoftHyphen) {
          hyp_width = get_word_width('-', break_token.font);
          if (break_rep.width + hyp_width > width(line_index)) {
            // won't fit so we'll try again if we have more breaks
            break_accepted = !line_breaks.length;
          }
        }
      }
      while (!break_accepted);

      // out of space... need to linebreak
      breaks.push(break_rep.index + 1);
      line_width = 0;
      line_index++;

      index = break_rep.index;
      line_breaks = [];
    }

    index++;
    last_was_whitespace = token.whitespace;
  }
  // cut remainder of last line if needed
  if (index !== breaks[breaks.length - 1]) {
    breaks.push(index);
  }

  // convert breakpoints to lines
  let last_break = 0;
  lines = breaks.map(p => {
    // find first token that is not "junk"
    let s = last_break;
    let t;
    while ((t = tokens[s]) && (t.whitespace || !t.value)) {
      // this trims breaks and whitespace from the start of the line
      s++;
    }
    // find last token that is not "junk"
    let e = p;
    let hardbreak = null;
    while ((e > s) && (t = tokens[e - 1]) &&
      (t.whitespace || !(t.value || t instanceof SoftHyphen))) {
      // this trims breaks and whitespace from the end of the line
      if (t instanceof LineBreak) {
        // preserve hard breaks so we can justify text later
        hardbreak = t;
      }
      e--;
    }
    // last token in line is a soft-hyphen, which expands to a dash
    if (t instanceof SoftHyphen) {
      t.value = '-';
      t.width = get_word_width('-', t.font);
    }
    // next start pos
    last_break = p;
    // cut and clean the line
    const line = tokens.slice(s, e).filter(d => d.value);
    if (hardbreak) {
      line.push(hardbreak);
    }
    return line;
  });

  // overflow needed?
  const overflow = (opt.overflow() === 'ellipsis') ? '…' : opt.overflow();
  if (overflow && index !== tokens.length) {
    const line_width = width(lines.length - 1);
    const last_line = lines[lines.length - 1];
    const o_token = new Token(overflow);
    o_token.font = f_base;
    o_token.width = get_word_width(overflow, f_bold);
    overflow_line(last_line, line_width, o_token);
  }

  lines.font = f_base;

  return lines;
};