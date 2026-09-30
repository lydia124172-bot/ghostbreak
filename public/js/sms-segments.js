/* SMS segment calculator — client-side mirror of services/sms-segments.js */
(function (global) {
  const GSM_BASIC =
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  const GSM_EXTENDED = '|^€{}[]~\\';
  const GSM_BASIC_SET = new Set(GSM_BASIC.split(''));
  const GSM_EXTENDED_SET = new Set(GSM_EXTENDED.split(''));

  function countGsmSeptets(text) {
    let septets = 0;
    for (const char of text) {
      if (GSM_BASIC_SET.has(char)) septets += 1;
      else if (GSM_EXTENDED_SET.has(char)) septets += 2;
      else return null;
    }
    return septets;
  }

  function countUcs2Units(text) {
    let units = 0;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) {
        units += 2;
        i += 1;
      } else {
        units += 1;
      }
    }
    return units;
  }

  function segmentsFromUnits(units, encoding) {
    const isUcs2 = encoding === 'UCS-2';
    const singleLimit = isUcs2 ? 70 : 160;
    const multiLimit = isUcs2 ? 67 : 153;
    if (units <= singleLimit) {
      return { segments: 1, singleLimit, multiLimit, remaining: singleLimit - units };
    }
    const segments = Math.ceil(units / multiLimit);
    const usedInLast = units - (segments - 1) * multiLimit;
    return { segments, singleLimit, multiLimit, remaining: multiLimit - usedInLast };
  }

  function analyzeSms(text) {
    const body = String(text ?? '');
    const charCount = body.length;
    const gsmSeptets = countGsmSeptets(body);

    if (gsmSeptets !== null) {
      const result = segmentsFromUnits(gsmSeptets, 'GSM-7');
      return {
        charCount,
        units: gsmSeptets,
        unitLabel: 'septets',
        encoding: 'GSM-7',
        segments: result.segments,
        singleLimit: result.singleLimit,
        multiLimit: result.multiLimit,
        remainingInCurrentSegment: result.remaining,
        isMultipart: result.segments > 1,
      };
    }

    const units = countUcs2Units(body);
    const result = segmentsFromUnits(units, 'UCS-2');
    return {
      charCount,
      units,
      unitLabel: 'characters (UCS-2)',
      encoding: 'UCS-2',
      segments: result.segments,
      singleLimit: result.singleLimit,
      multiLimit: result.multiLimit,
      remainingInCurrentSegment: result.remaining,
      isMultipart: result.segments > 1,
    };
  }

  global.SmsSegments = { analyzeSms };
})(typeof window !== 'undefined' ? window : globalThis);
