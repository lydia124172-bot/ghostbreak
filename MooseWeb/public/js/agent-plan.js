function setAgentPlanBar(bar, data, opts) {
  const o = opts || {};
  if (!bar) return;
  if (data.ready === false) {
    bar.textContent = o.notReady || '暫時無法使用，請稍後再試。';
    return;
  }
  if (data.unlimited || data.paid) {
    bar.textContent = '已購買付費工具方案，此智能體不限次數。';
    return;
  }
  const left = Number(data.left != null ? data.left : 0);
  const limit = Number(data.limit != null ? data.limit : 1);
  if (left > 0) {
    bar.innerHTML = `試用尚可產出 ${left} 次（本智能體限 ${limit} 次）。<a href="/account">購買付費工具方案</a>後不限次數。`;
  } else {
    bar.innerHTML = `試用已用完（限 ${limit} 次）。<a href="/account">購買付費工具方案</a>後不限次數。`;
  }
}

function agentPlanFromStoryStatus(st) {
  return {
    ready: st.script,
    paid: st.scriptPaid,
    unlimited: st.scriptPaid,
    left: st.scriptLeft,
    limit: st.scriptLimit,
  };
}
