/**
 * outlook-analyzer / parser.js
 * Parser puro (sin DOM) de correos .eml + análisis de hilos de un buzón compartido.
 * Funciona en navegador y en Node (para pruebas).
 * Todo el procesamiento es local: los correos nunca salen del equipo.
 */
(function (factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.MailParser = api;
})(function () {
  'use strict';

  // ---------- utilidades ----------
  function b64ToBytes(b64) {
    var bin = '';
    if (typeof atob !== 'undefined') bin = atob(b64.replace(/\s+/g, ''));
    else bin = Buffer.from(b64.replace(/\s+/g, ''), 'base64').toString('binary');
    var out = new Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
    return out;
  }

  function bytesToText(bytes, charset) {
    var label = 'utf-8';
    if (charset) {
      var c = String(charset).toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (/^(iso88591|latin1|windows1252|cp1252)$/.test(c)) label = 'windows-1252';
    }
    try {
      if (typeof TextDecoder !== 'undefined') return new TextDecoder(label, { fatal: false }).decode(new Uint8Array(bytes));
      if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString(label === 'windows-1252' ? 'latin1' : 'utf8');
    } catch (e) { /* sigue */ }
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  // Decodifica palabras RFC2047: =?UTF-8?B?...?= / =?ISO-8859-1?Q?...?=
  function decodeWords(s) {
    if (!s || s.indexOf('=?') === -1) return s || '';
    return String(s).replace(/=\?([^?\s]+)\?([bqBQ])\?([^?]*)\?=/g, function (m, charset, enc, data) {
      try {
        if (enc.toUpperCase() === 'B') return bytesToText(b64ToBytes(data), charset);
        var t = String(data).replace(/_/g, ' ');
        var bytes = [];
        t.replace(/=([0-9A-Fa-f]{2})|([^=]+)/g, function (mm, hex, plain) {
          if (hex) bytes.push(parseInt(hex, 16));
          else for (var i = 0; i < plain.length; i++) bytes.push(plain.charCodeAt(i) & 255);
          return '';
        });
        return bytesToText(bytes, charset);
      } catch (e) { return data; }
    });
  }

  function decodeQP(s) {
    var bytes = [];
    String(s).replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})|([^=]+)/g, function (m, hex, plain) {
      if (hex) bytes.push(parseInt(hex, 16));
      else for (var i = 0; i < plain.length; i++) bytes.push(plain.charCodeAt(i) & 255);
      return '';
    });
    return bytes;
  }

  function decodeBodyBytes(text, encoding, charset) {
    var enc = String(encoding || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (enc === 'base64') return bytesToText(b64ToBytes(text), charset);
    if (enc === 'quotedprintable') return bytesToText(decodeQP(text), charset);
    return text;
  }

  function charsetOf(ct) {
    var m = String(ct || '').match(/charset\s*=\s*"?([^";\s]+)"?/i);
    return m ? m[1] : '';
  }

  function stripHtml(html) {
    return String(html)
      .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  }

  function cleanBody(s) {
    s = String(s || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // corta firmas y citas al responder
    s = s.split(/\n-- \n/)[0];
    var lines = s.split('\n'), out = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (/^\s*>/.test(ln)) continue; // citas
      if (/^\s*El .* escribi[oó]:\s*$/i.test(ln)) break; // "El ... escribió:"
      if (/^\s*On .* wrote:\s*$/i.test(ln)) break;
      out.push(ln);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ---------- .eml ----------
  function splitEML(text) {
    var t = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var i = t.search(/\n\n/);
    if (i === -1) return { headers: t, body: '' };
    return { headers: t.slice(0, i), body: t.slice(i + 2) };
  }

  function parseHeaders(block) {
    var unfolded = String(block).replace(/\n[ \t]+/g, ' ');
    var out = {};
    unfolded.split('\n').forEach(function (ln) {
      var ci = ln.indexOf(':');
      if (ci === -1) return;
      var k = ln.slice(0, ci).trim().toLowerCase();
      var v = ln.slice(ci + 1).trim();
      if (out[k]) out[k] += ' ' + v;
      else out[k] = v;
    });
    return out;
  }

  function parseAddress(v) {
    v = decodeWords(v || '').trim();
    var m = v.match(/"([^"]*)"\s*<([^<>\s]+@[^<>\s]+)>/);
    if (m) return { name: (m[1] || '').trim() || m[2], email: m[2].toLowerCase() };
    m = v.match(/([^<>\s]+)\s*<([^<>\s]+@[^<>\s]+)>/);
    if (m) return { name: (m[1] || '').trim() || m[2], email: m[2].toLowerCase() };
    var e = v.match(/([^\s<>,;"]+@[^\s<>,;"]+)/);
    if (e) return { name: e[1], email: e[1].toLowerCase() };
    return { name: v.trim() || '(desconocido)', email: '' };
  }

  function extractBody(headers, body) {
    var ct = String(headers['content-type'] || '');
    var bm = ct.match(/boundary\s*=\s*"?([^";\s]+)"?/i);
    var htmlFallback = '';
    if (bm) {
      var b = bm[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var parts = String(body).split(new RegExp('--' + b + '(?:--)?\\s*\\n?'));
      for (var i = 0; i < parts.length; i++) {
        var sp = splitEML(parts[i].replace(/^\n+/, ''));
        var ph = parseHeaders(sp.headers);
        var pct = String(ph['content-type'] || '').toLowerCase();
        if (/attachment/i.test(String(ph['content-disposition'] || ''))) continue;
        var dec = decodeBodyBytes(sp.body, ph['content-transfer-encoding'], charsetOf(ph['content-type']));
        if (pct.indexOf('text/plain') !== -1) return dec;
        if (!htmlFallback && pct.indexOf('text/html') !== -1) htmlFallback = stripHtml(dec);
      }
      if (htmlFallback) return htmlFallback;
      return '';
    }
    var dec0 = decodeBodyBytes(body, headers['content-transfer-encoding'], charsetOf(ct));
    if (ct.toLowerCase().indexOf('text/html') !== -1) return stripHtml(dec0);
    return dec0;
  }

  /** Parsea un .eml a {id, subject, from, date, inReplyTo, references, body}. */
  function parseEML(text, fname) {
    var sp = splitEML(text);
    var h = parseHeaders(sp.headers);
    var refs = [];
    if (h.references) {
      var rm = String(decodeWords(h.references)).match(/<[^<>\s]+>/g);
      if (rm) refs = rm;
    }
    var irt = h['in-reply-to'] ? (String(decodeWords(h['in-reply-to'])).match(/<[^<>\s]+>/) || []) : [];
    var mid = h['message-id'] ? (String(h['message-id']).match(/<[^<>\s]+>/) || []) : [];
    var dt = h.date ? new Date(h.date.replace(/UT$/i, 'UTC')) : null;
    if (dt && isNaN(dt.getTime())) dt = null;
    return {
      id: mid.length ? mid[0] : ('noid:' + (fname || Math.random().toString(36).slice(2))),
      subject: decodeWords(h.subject || '(sin asunto)').replace(/\s+/g, ' ').trim(),
      from: parseAddress(h.from || h.sender || ''),
      date: dt,
      inReplyTo: irt.length ? irt[0] : '',
      references: refs,
      body: cleanBody(extractBody(h, sp.body))
    };
  }

  function normSubject(s) {
    var t = String(s || '').toLowerCase().replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
    var prev;
    do { prev = t; t = t.replace(/^(re|rv|fwd?|aw|wg|antw)\s*:\s*/, ''); } while (t !== prev);
    return t.replace(/\s+/g, ' ').trim();
  }

  /**
   * Agrupa correos en hilos: mismo asunto normalizado, con corte si hay
   * un hueco mayor a gapHours (defecto 168 = 7 días).
   */
  function threadMessages(emails, gapHours) {
    var gap = (gapHours != null ? gapHours : 168) * 3600 * 1000;
    var valid = emails.filter(function (e) { return e.date; });
    var groups = {};
    valid.forEach(function (e) {
      var k = normSubject(e.subject) || ('sin-asunto:' + e.id);
      (groups[k] = groups[k] || []).push(e);
    });
    var threads = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k].sort(function (a, b) { return a.date - b.date; });
      var cur = [];
      g.forEach(function (e) {
        if (cur.length && (e.date - cur[cur.length - 1].date) > gap) {
          threads.push(mkThread(k, cur));
          cur = [];
        }
        cur.push(e);
      });
      if (cur.length) threads.push(mkThread(k, cur));
    });
    return threads;
  }

  function mkThread(key, msgs) {
    return { key: key, subject: msgs[0].subject, messages: msgs };
  }

  // ---------- análisis ----------
  function senderKey(from) {
    return (from.email || from.name || '').toLowerCase();
  }

  /**
   * Analiza hilos de un buzón compartido.
   * options: { windowHours (def 168), supportOnly, supportSet, gapHours (def 168) }
   * Conversación: {id, subject, requester, requestedAt, requestText, responder,
   *   respondedAt, responseText, minutesToResponse, messageCount, status, confidence,
   *   reopened, ...}
   */
  function analyzeEmails(emails, options) {
    options = options || {};
    var windowHours = options.windowHours != null ? options.windowHours : 168;
    var supportSet = null;
    if (options.supportSet) {
      supportSet = {};
      options.supportSet.forEach(function (a) { supportSet[String(a).toLowerCase()] = 1; });
    }
    var windowMs = windowHours * 3600 * 1000;
    var threads = threadMessages(emails, options.gapHours);

    function inSupport(from) {
      if (!supportSet) return true;
      var k = senderKey(from);
      if (supportSet[k]) return true;
      return !!supportSet[String(from.name || '').toLowerCase()];
    }

    var convs = threads.map(function (th, idx) {
      var msgs = th.messages;
      var first = msgs[0];
      var found = null;
      for (var j = 1; j < msgs.length; j++) {
        var m = msgs[j];
        if (m.date - first.date > windowMs) break;
        if (senderKey(m.from) === senderKey(first.from)) continue;
        if (!inSupport(m.from)) continue;
        found = m;
        break;
      }
      var minutes = found ? Math.round(((found.date - first.date) / 60000) * 10) / 10 : null;
      var reopened = null, reopenCount = 0;
      if (found) {
        for (var k = 1; k < msgs.length; k++) {
          if (msgs[k] === found) continue;
          if (msgs[k].date <= found.date) continue;
          if (senderKey(msgs[k].from) === senderKey(found.from)) continue;
          reopenCount++;
          if (!reopened) reopened = msgs[k];
        }
      }
      var wired = found && (found.inReplyTo || (found.references && found.references.length));
      return {
        id: 'mail-' + idx,
        subject: th.subject,
        thread: msgs.map(function (m) {
          return { from: m.from.name, email: m.from.email, date: m.date, body: (m.body || '').slice(0, 600) };
        }),
        requester: first.from.name,
        requesterEmail: first.from.email,
        requestedAt: first.date,
        requestText: (first.body || '').slice(0, 280),
        responder: found ? found.from.name : null,
        responderEmail: found ? found.from.email : null,
        respondedAt: found ? found.date : null,
        responseText: found ? (found.body || '').split('\n')[0].slice(0, 280) : null,
        minutesToResponse: minutes,
        messageCount: msgs.length,
        status: found ? 'respondido' : 'pendiente',
        confidence: found ? (wired ? 'alta' : 'media') : null,
        reopened: !!reopened,
        reopenedBy: reopened ? reopened.from.name : null,
        reopenedAt: reopened ? reopened.date : null,
        reopenedText: reopened ? (reopened.body || '').split('\n')[0].slice(0, 280) : null,
        reopenCount: reopenCount
      };
    });

    convs.sort(function (a, b) { return b.requestedAt - a.requestedAt; });

    var responded = convs.filter(function (c) { return c.status === 'respondido'; });
    var diffs = responded.map(function (c) { return c.minutesToResponse; }).sort(function (a, b) { return a - b; });
    function pct(q) {
      if (!diffs.length) return null;
      return diffs[Math.min(diffs.length - 1, Math.floor(q * diffs.length))];
    }
    var avg = diffs.length ? diffs.reduce(function (a, b) { return a + b; }, 0) / diffs.length : null;

    return {
      conversations: convs,
      stats: {
        total: convs.length,
        responded: responded.length,
        pending: convs.length - responded.length,
        responseRate: convs.length ? Math.round((responded.length / convs.length) * 1000) / 10 : 0,
        avgMinutes: avg != null ? Math.round(avg * 10) / 10 : null,
        medianMinutes: pct(0.5),
        p90Minutes: pct(0.9),
        windowHours: windowHours,
        mailCount: emails.length
      }
    };
  }

  /** Sugiere equipo de soporte: quienes más responden y rara vez inician hilos. */
  function suggestSupport(emails, limit) {
    var threads = threadMessages(emails);
    var opened = {}, replied = {};
    threads.forEach(function (th) {
      opened[senderKey(th.messages[0].from)] = (opened[senderKey(th.messages[0].from)] || 0) + 1;
      var seen = {};
      th.messages.forEach(function (m, i) {
        if (i === 0) return;
        var k = senderKey(m.from);
        if (!seen[k + th.subject]) { seen[k + th.subject] = 1; replied[k] = (replied[k] || 0) + 1; }
      });
    });
    var names = {};
    emails.forEach(function (e) {
      var k = senderKey(e.from);
      if (!names[k] && e.from.name) names[k] = e.from.name;
    });
    return Object.keys(replied).map(function (k) {
      return { name: names[k] || k, replies: replied[k], opened: opened[k] || 0 };
    }).sort(function (a, b) { return b.replies - a.replies; }).slice(0, limit || 10);
  }

  var TOPIC_STOP = ('de,la,el,en,y,a,los,del,se,las,por,un,una,con,para,que,como,esta,este,esto,son,es,su,sus,mi,mis,tu,tus,al,lo,le,les,mas,más,muy,sin,sobre,entre,hasta,desde,donde,cuando,porque,hola,buen,buenos,buena,buenas,dias,día,favor,porfa,porfis,gracias,apoyo,apoyan,solicitud,solicito,solicita,consulta,ayuda,urgente,importante,correo,correos,saludos,atte,atentamente,estimados,estimado,buenas,tardes,noches,ante,esto,esta,esta,fwd,re,rv,aw,ot,caso,casos,tema,informacion,información,seguimiento,pendiente,cliente,clientes,empresa,servicio,servicios,favor,need,please,thanks,hello,request,support,help,fwd,forward,the,and,for,with,from,that,this,have,has,are,favor,nota,aviso,revision,revisión,error,falla,problema,fallo').split(',');

  var ACC = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n' };
  function normWord(s) {
    return String(s || '').toLowerCase()
      .replace(/[áéíóúüñ]/g, function (c) { return ACC[c]; })
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Temas frecuentes: palabras significativas de los asuntos, con métricas
   * de las conversaciones que las contienen.
   */
  function topics(conversations, n) {
    var perWord = {};
    conversations.forEach(function (c, i) {
      var words = {};
      String(c.subject || '').toLowerCase().replace(/[a-záéíóúñü]+/gi, function (w) {
        var nw = normWord(w);
        if (nw.length >= 4 && TOPIC_STOP.indexOf(nw) === -1) words[nw] = 1;
        return '';
      });
      Object.keys(words).forEach(function (w) {
        (perWord[w] = perWord[w] || []).push(i);
      });
    });
    var total = conversations.length || 1;
    return Object.keys(perWord).map(function (w) {
      var idx = perWord[w];
      var timed = [], pend = 0;
      idx.forEach(function (i) {
        var c = conversations[i];
        if (c.minutesToResponse != null) timed.push(c.minutesToResponse);
        if (c.status === 'pendiente') pend++;
      });
      timed.sort(function (a, b) { return a - b; });
      var avg = timed.length ? timed.reduce(function (a, b) { return a + b; }, 0) / timed.length : null;
      return { word: w, count: idx.length,
        pct: Math.round((idx.length / total) * 1000) / 10,
        avg: avg != null ? Math.round(avg * 10) / 10 : null, pending: pend };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, n || 15);
  }

  function topicMatch(subject, word) {
    var words = {};
    String(subject || '').toLowerCase().replace(/[a-záéíóúñü]+/gi, function (w) {
      words[normWord(w)] = 1;
      return '';
    });
    return !!words[word];
  }

  // ---------- reutilizadas del analizador WhatsApp ----------
  function rangeOf(min) {
    if (min == null) return null;
    if (min < 60) return '0-1h';
    if (min < 480) return '1-8h';
    if (min < 1440) return '8-24h';
    return '+24h';
  }

  var RANGE_LABELS = { '0-1h': '0–1 h', '1-8h': '1–8 h', '8-24h': '8–24 h', '+24h': '+24 h' };

  function summarize(convs) {
    var responded = convs.filter(function (c) { return c.status === 'respondido'; });
    var diffs = responded.map(function (c) { return c.minutesToResponse; }).sort(function (a, b) { return a - b; });
    function pct(q) {
      if (!diffs.length) return null;
      return diffs[Math.min(diffs.length - 1, Math.floor(q * diffs.length))];
    }
    var avg = diffs.length ? diffs.reduce(function (a, b) { return a + b; }, 0) / diffs.length : null;
    var reopenedCount = convs.filter(function (c) { return c.reopened; }).length;
    var ranges = { '0-1h': 0, '1-8h': 0, '8-24h': 0, '+24h': 0 };
    responded.forEach(function (c) { ranges[rangeOf(c.minutesToResponse)]++; });
    return {
      total: convs.length,
      responded: responded.length,
      pending: convs.length - responded.length,
      reopened: reopenedCount,
      responseRate: convs.length ? Math.round((responded.length / convs.length) * 1000) / 10 : 0,
      avgMinutes: avg != null ? Math.round(avg * 10) / 10 : null,
      medianMinutes: pct(0.5),
      p90Minutes: pct(0.9),
      ranges: ranges
    };
  }

  function statsBy(convs, n) {
    var req = {}, resp = {};
    convs.forEach(function (c) {
      var r = req[c.requester] = req[c.requester] || { name: c.requester, count: 0, sum: 0, timed: 0 };
      r.count++;
      if (c.minutesToResponse != null) { r.sum += c.minutesToResponse; r.timed++; }
      if (c.responder) {
        var s = resp[c.responder] = resp[c.responder] || { name: c.responder, count: 0, sum: 0, timed: 0 };
        s.count++;
        if (c.minutesToResponse != null) { s.sum += c.minutesToResponse; s.timed++; }
      }
    });
    function list(obj) {
      return Object.keys(obj).map(function (k) {
        var o = obj[k];
        return { name: o.name, count: o.count,
          avg: o.timed ? Math.round((o.sum / o.timed) * 10) / 10 : null };
      }).sort(function (a, b) { return b.count - a.count; }).slice(0, n || 10);
    }
    return { requesters: list(req), responders: list(resp) };
  }

  function monthKey(d) {
    d = d instanceof Date ? d : new Date(d);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  }

  return {
    parseEML: parseEML,
    threadMessages: threadMessages,
    analyzeEmails: analyzeEmails,
    suggestSupport: suggestSupport,
    topics: topics,
    topicMatch: topicMatch,
    summarize: summarize,
    statsBy: statsBy,
    rangeOf: rangeOf,
    RANGE_LABELS: RANGE_LABELS,
    monthKey: monthKey,
    decodeWords: decodeWords,
    normSubject: normSubject
  };
});
