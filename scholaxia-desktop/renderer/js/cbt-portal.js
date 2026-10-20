(function () {
  var cfg = window.CBT_PORTAL_CONFIG;
  if (!cfg) return;

  var poolCache = {};
  var ALOC_EXAM_TYPES = ["JAMB", "WAEC", "NECO", "POST_UTME"];

  function normalizeSubjectKey(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function normalizeExamType(examType) {
    var raw = String(examType || "JAMB").trim().toUpperCase().replace(/-/g, "_");
    if (raw === "POSTUTME" || raw === "POST_UTME") return "POST_UTME";
    if (ALOC_EXAM_TYPES.indexOf(raw) >= 0) return raw;
    return "JAMB";
  }

  function resolveCategory(examType) {
    return normalizeExamType(examType);
  }

  function formatExamLabel(examType) {
    var t = normalizeExamType(examType);
    if (t === "POST_UTME") return "POST-UTME";
    return t;
  }

  function subjectLimit(category) {
    var cat = resolveCategory(category);
    if (cat === "JAMB" || cat === "POST_UTME") return 4;
    return 9;
  }

  function questionCount(category, subject) {
    var cat = resolveCategory(category);
    var subj = String(subject || "").toLowerCase();
    if (cat === "JAMB") return subj.includes("english") ? 60 : 40;
    if (cat === "WAEC" || cat === "NECO") return 40;
    if (cat === "POST_UTME") return 40;
    return 10;
  }

  function durationMinutes(category, isCombined) {
    var cat = resolveCategory(category);
    if (isCombined) {
      if (cat === "JAMB") return 120;
      if (cat === "POST_UTME") return 90;
      if (cat === "WAEC" || cat === "NECO") return 240;
    }
    if (cat === "JAMB") return 90;
    if (cat === "WAEC" || cat === "NECO") return 40;
    if (cat === "POST_UTME") return 60;
    return 30;
  }

  function optionLetter(index) {
    return ["A", "B", "C", "D"][index] || "A";
  }

  function shuffledQuestions(questions) {
    var shuffled = (questions || []).slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var value = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = value;
    }
    return shuffled;
  }

  function convertQuestion(q, index, subject) {
    var options = Array.isArray(q.options) ? q.options : [];
    var correctIdx = typeof q.correctAnswer === "number" ? q.correctAnswer : 0;
    return {
      id: "portal-q-" + index,
      question_text: q.question || q.text || "",
      option_a: options[0] || "",
      option_b: options[1] || "",
      option_c: options[2] || "",
      option_d: options[3] || "",
      correct_option: optionLetter(correctIdx),
      explanation: q.explanation || "",
      topic: subject || "",
      image_url: q.image_url || q.image || "",
    };
  }

  async function fetchPracticePool(category) {
    var key = resolveCategory(category);
    if (poolCache[key]) return poolCache[key];
    var data = null;
    if (typeof api === "function") {
      try {
        var guest = typeof isStudentLoggedIn === "function" && !isStudentLoggedIn();
        data = await api("/api/v1/cbt/practice-bank/" + (guest ? "guest/" : "") + key);
      } catch (e) {
        if (key === "POST_UTME") data = [];
        else throw e;
      }
    } else {
      var url = cfg.practiceBaseUrl + "/" + key.toLowerCase().replace("_", "-") + ".json";
      var res = await fetch(url, { signal: typeof fetchTimeout === "function" ? fetchTimeout(45000) : undefined });
      if (!res.ok) throw new Error("CBT question bank unavailable (" + key + ")");
      data = await res.json();
    }
    var raw = Array.isArray(data)
      ? data
      : (Array.isArray(data.subjects) ? data.subjects : (Array.isArray(data.questions) ? data.questions : []));
    raw = raw.filter(function (e) {
      return e && e.subject && Array.isArray(e.questions) && e.questions.length > 0;
    });
    poolCache[key] = raw;
    return raw;
  }

  function findSubjectEntry(pool, subjectName) {
    var target = normalizeSubjectKey(subjectName);
    if (!target) return null;

    var exact = pool.find(function (entry) {
      return normalizeSubjectKey(entry && entry.subject) === target;
    });
    if (exact) return exact;

    return pool.find(function (entry) {
      var key = normalizeSubjectKey(entry && entry.subject);
      if (!key || !Array.isArray(entry.questions) || !entry.questions.length) return false;
      if (key.includes(target) || target.includes(key)) return true;
      if (target.indexOf("english") >= 0 && key.indexOf("english") >= 0) return true;
      if (target.indexOf("math") >= 0 && key.indexOf("math") >= 0) return true;
      if (target.indexOf("econ") >= 0 && key.indexOf("econ") >= 0) return true;
      if (target.indexOf("lit") >= 0 && key.indexOf("literature") >= 0) return true;
      if (target.indexOf("gov") >= 0 && key.indexOf("government") >= 0) return true;
      if (target.indexOf("crk") >= 0 && (key.indexOf("christian") >= 0 || key.indexOf("religious") >= 0)) return true;
      return false;
    }) || null;
  }

  function portalExamId(category, subject) {
    return "portal:" + resolveCategory(category) + ":" + subject;
  }

  function alocCombinedId(category) {
    return "aloc:" + resolveCategory(category) + ":combined";
  }

  var JAMB_COMBINED_ID = "portal:JAMB:combined";

  function orderSubjects(subjects) {
    var list = (subjects || []).slice();
    var englishIdx = list.findIndex(function (s) {
      return String(s || "").toLowerCase().indexOf("english") >= 0;
    });
    if (englishIdx > 0) {
      var eng = list.splice(englishIdx, 1)[0];
      list.unshift(eng);
    }
    return list;
  }

  function combinedQuestionTotal(category, subjects) {
    return (subjects || []).reduce(function (sum, subject) {
      return sum + questionCount(category, subject);
    }, 0);
  }

  function buildCombinedExam(pool, subjects, category, opts) {
    opts = opts || {};
    var allowPartial = !!opts.allowPartial;
    var cat = resolveCategory(category);
    var ordered = orderSubjects(subjects);
    var items = [];
    var sections = [];
    var matched = [];
    var missing = [];
    ordered.forEach(function (subject) {
      var entry = findSubjectEntry(pool, subject);
      if (!entry || !Array.isArray(entry.questions) || !entry.questions.length) {
        if (allowPartial) {
          missing.push(subject);
          return;
        }
        throw new Error("No questions found for " + subject);
      }
      matched.push(subject);
      var count = Math.min(questionCount(cat, subject), entry.questions.length);
      var start = items.length;
      shuffledQuestions(entry.questions).slice(0, count).forEach(function (q, i) {
        items.push(convertQuestion(q, start + i, subject));
      });
      sections.push({ subject: subject, start: start, count: count });
    });
    return { questions: items, sections: sections, subjects: matched, missing: missing };
  }

  function getProfileSubjects() {
    if (typeof getUser === "function") {
      var user = getUser();
      if (user.subjects && user.subjects.length) return user.subjects;
    }
    try {
      return JSON.parse(localStorage.getItem("sia_subjects") || "[]");
    } catch (e) {
      return [];
    }
  }

  function getProfileExamType() {
    if (typeof getUser === "function") {
      var user = getUser();
      if (user.examType) return normalizeExamType(user.examType);
    }
    return normalizeExamType(localStorage.getItem("sia_exam_type") || "JAMB");
  }

  function parsePortalExamId(examId) {
    var parts = String(examId || "").split(":");
    if (parts.length < 3 || parts[0] !== "portal") return null;
    return { category: parts[1], subject: parts.slice(2).join(":") };
  }

  function parseAlocExamId(examId) {
    var parts = String(examId || "").split(":");
    if (parts.length < 3 || parts[0] !== "aloc") return null;
    return { category: normalizeExamType(parts[1]), subject: parts.slice(2).join(":") };
  }

  function profileReadyForCombined(category, subjects) {
    var cat = resolveCategory(category);
    var limit = subjectLimit(cat);
    if (cat === "JAMB" || cat === "POST_UTME") return subjects.length === limit;
    return subjects.length >= 1;
  }

  async function loadAlocExamPreview() {
    if (typeof api !== "function") return null;
    try {
      return await api("/api/v1/cbt/aloc/exam-preview");
    } catch (e) {
      try {
        return await api("/api/v1/cbt/aloc/jamb-preview");
      } catch (e2) {
        return null;
      }
    }
  }

  async function loadPortalPracticeExams(profileOverride) {
    var examType = "";
    var subjects = [];
    var profile = profileOverride;
    var guest = typeof isStudentLoggedIn === "function" && !isStudentLoggedIn();

    if (!profile && typeof api === "function" && !guest) {
      try {
        profile = await api("/api/v1/students/me");
      } catch (e) {
        profile = null;
      }
    }

    if (profile) {
      examType = profile.exam_type || "";
      subjects = profile.selected_subjects || [];
      if (typeof localStorage !== "undefined") {
        if (examType) localStorage.setItem("sia_exam_type", formatExamType(examType));
        localStorage.setItem("sia_subjects", JSON.stringify(subjects));
      }
    }

    if (!subjects.length && guest && typeof localStorage !== "undefined") {
      try {
        var savedSubjects = JSON.parse(localStorage.getItem("sia_subjects") || "[]");
        subjects = Array.isArray(savedSubjects) ? savedSubjects : [];
        examType = localStorage.getItem("sia_exam_type") || "JAMB";
      } catch (e) {
        console.warn("Could not read saved guest CBT profile", e);
      }
    }

    if (!subjects.length && typeof getUser === "function") {
      var user = getUser();
      examType = examType || user.examType;
      subjects = Array.isArray(user.subjects) ? user.subjects : [];
    }
    if (!subjects.length) return [];

    var category = resolveCategory(examType);
    var bankLabel = (cfg && cfg.blogBankLabel) || "Scholaxia CBT Bank";
    var preferBlog = !cfg || cfg.useBlogCbtBank !== false;

    if (profileReadyForCombined(category, subjects) && !preferBlog) {
      var alocCard = await loadAlocExamPreview();
      if (alocCard && alocCard.id) return [alocCard];
    }

    var pool;
    try {
      pool = await fetchPracticePool(category);
    } catch (e) {
      console.warn("Portal CBT load failed", e);
      if (preferBlog && profileReadyForCombined(category, subjects)) {
        var alocFallback = await loadAlocExamPreview();
        if (alocFallback && alocFallback.id) return [alocFallback];
      }
      return [];
    }

    if (profileReadyForCombined(category, subjects)) {
      var ordered = orderSubjects(subjects);
      var matched = [];
      var missing = [];
      ordered.forEach(function (subject) {
        var entry = findSubjectEntry(pool, subject);
        if (entry && Array.isArray(entry.questions) && entry.questions.length) matched.push(subject);
        else missing.push(subject);
      });
      if (matched.length) {
        var label = formatExamLabel(category);
        return [{
          id: portalExamId(category, "combined"),
          title: label + " CBT Practice Exam",
          subject: matched.join(" · "),
          exam_type: category,
          total_questions: combinedQuestionTotal(category, matched),
          duration_minutes: durationMinutes(category, true),
          is_portal: true,
          is_combined: true,
          is_aloc: false,
          subjects: matched,
          missing_subjects: missing,
          source: bankLabel,
        }];
      }
      if (!preferBlog) {
        var alocCard2 = await loadAlocExamPreview();
        if (alocCard2 && alocCard2.id) return [alocCard2];
      }
      return [];
    }

    return subjects.map(function (subject) {
      var entry = findSubjectEntry(pool, subject);
      if (!entry || !Array.isArray(entry.questions) || !entry.questions.length) return null;
      var count = Math.min(questionCount(category, subject), entry.questions.length);
      return {
        id: portalExamId(category, subject),
        title: formatExamLabel(category) + " " + subject + " Practice",
        subject: subject,
        exam_type: category,
        total_questions: count,
        duration_minutes: durationMinutes(category),
        is_portal: true,
        source: bankLabel,
      };
    }).filter(Boolean);

    if (preferBlog && category === "POST_UTME" && profileReadyForCombined(category, subjects)) {
      var alocPost = await loadAlocExamPreview();
      if (alocPost && alocPost.id) return [alocPost];
    }

    return [];
  }

  function rebuildAlocSections(exam) {
    if (!exam || !exam.questions || !exam.questions.length) {
      if (exam) exam.sections = [];
      return;
    }
    var sections = [];
    var i = 0;
    while (i < exam.questions.length) {
      var topic = exam.questions[i].topic || "";
      var subject = topic.replace(/\s*\(\d{4}\)\s*$/, "").trim() || "Subject";
      var j = i + 1;
      while (j < exam.questions.length) {
        var next = (exam.questions[j].topic || "").replace(/\s*\(\d{4}\)\s*$/, "").trim();
        if (next !== subject) break;
        j++;
      }
      sections.push({ subject: subject, start: i, count: j - i });
      i = j;
    }
    exam.sections = sections;
  }

  function yearLabelForCategory(category) {
    var cat = resolveCategory(category);
    if (cat === "JAMB") return "UTME";
    if (cat === "POST_UTME") return "POST-UTME";
    return cat;
  }

  async function beginPortalExam(examId, opts) {
    opts = opts || {};
    if (String(examId || "").indexOf("aloc:") === 0) {
      if (typeof api !== "function") throw new Error("ALOC exam requires API connection");
      var path = "/api/v1/cbt/aloc/exam";
      if (opts.year) path += "?year=" + encodeURIComponent(opts.year);
      var alocOpts = typeof fetchTimeout === "function" ? { signal: fetchTimeout(90000) } : {};
      var aloc;
      try {
        aloc = await api(path, alocOpts);
      } catch (e) {
        if (String(examId).indexOf("aloc:JAMB:") === 0) {
          var legacy = "/api/v1/cbt/aloc/jamb-exam";
          if (opts.year) legacy += "?year=" + encodeURIComponent(opts.year);
          aloc = await api(legacy, alocOpts);
        } else {
          throw e;
        }
      }
      if (!aloc || !aloc.exam || !aloc.exam.questions || !aloc.exam.questions.length) {
        var parsedAloc = parseAlocExamId(examId);
        var yl = yearLabelForCategory(parsedAloc ? parsedAloc.category : "JAMB");
        var yearHint = opts.year ? " for " + yl + " " + opts.year : "";
        throw new Error("No exam questions" + yearHint + ". Try another year or check ALOC_ACCESS_TOKEN on the server.");
      }
      if (opts.year) {
        aloc.exam.selected_year = String(opts.year);
        aloc.selected_year = String(opts.year);
        rebuildAlocSections(aloc.exam);
      }
      return {
        session: aloc.session,
        exam: aloc.exam,
        meta: aloc.meta,
        selected_year: aloc.selected_year || aloc.exam.selected_year || opts.year || "",
        secondsLeft: aloc.secondsLeft || aloc.exam.duration_minutes * 60,
      };
    }

    var parsed = parsePortalExamId(examId);
    if (!parsed) throw new Error("Invalid portal exam");

    var pool = await fetchPracticePool(parsed.category);
    var items;
    var title;
    var meta;
    var sections = null;
    var subjects = [];
    var cat = resolveCategory(parsed.category);

    if (parsed.subject === "combined" || (cat === "JAMB" && parsed.subject === "combined")) {
      subjects = getProfileSubjects();
      if (!profileReadyForCombined(cat, subjects)) {
        throw new Error(formatExamLabel(cat) + " requires " + subjectLimit(cat) + " subjects in Profile.");
      }
      var combined = buildCombinedExam(pool, subjects, cat, { allowPartial: true });
      if (!combined.questions.length) {
        throw new Error("Your subjects are not in the CBT bank yet. Change subjects in Profile.");
      }
      items = combined.questions;
      sections = combined.sections;
      subjects = combined.subjects;
      title = formatExamLabel(cat) + " CBT Practice Exam";
      meta = subjects.join(" · ") + " · " + items.length + " questions · CBT Bank";
      if (combined.missing.length) {
        meta += " · Missing in bank: " + combined.missing.join(", ");
      }
    } else if (cat === "JAMB" && parsed.subject === "combined") {
      subjects = getProfileSubjects();
      if (subjects.length !== 4) {
        throw new Error("JAMB requires exactly 4 subjects in Profile before starting the full CBT.");
      }
      var jambCombined = buildCombinedExam(pool, subjects, "JAMB", { allowPartial: true });
      if (!jambCombined.questions.length) {
        throw new Error("Your subjects are not in the CBT bank yet. Change subjects in Profile.");
      }
      items = jambCombined.questions;
      sections = jambCombined.sections;
      subjects = jambCombined.subjects;
      title = "JAMB CBT Practice Exam";
      meta = subjects.join(" · ") + " · " + items.length + " questions · 2 hrs · CBT Bank";
      if (jambCombined.missing.length) {
        meta += " · Missing in bank: " + jambCombined.missing.join(", ");
      }
    } else {
      var entry = findSubjectEntry(pool, parsed.subject);
      if (!entry || !Array.isArray(entry.questions) || !entry.questions.length) {
        throw new Error("No questions found for " + parsed.subject);
      }
      var count = questionCount(cat, parsed.subject);
      items = shuffledQuestions(entry.questions).slice(0, count).map(function (q, i) {
        return convertQuestion(q, i, parsed.subject);
      });
      title = formatExamLabel(cat) + " " + parsed.subject + " Practice";
      meta = parsed.subject + " · " + items.length + " questions · CBT Bank";
    }

    var isCombined = parsed.subject === "combined" || (cat === "JAMB" && parsed.subject === "combined");
    var mins = durationMinutes(cat, isCombined);

    return {
      session: {
        session_id: "portal-" + Date.now(),
        is_portal: true,
        is_school_exam: false,
      },
      exam: {
        id: examId,
        title: title,
        subject: subjects.length ? subjects.join(", ") : parsed.subject,
        exam_type: cat,
        duration_minutes: mins,
        total_questions: items.length,
        questions: items,
        sections: sections,
        is_combined: isCombined,
      },
      meta: meta,
      secondsLeft: mins * 60,
    };
  }

  function scorePortalExam(exam, answerSheet) {
    exam = exam || window.currentExam;
    answerSheet = answerSheet || window.answers || {};
    if (!exam || !exam.questions) {
      return { correct: 0, wrong: 0, total: 0, score_percent: 0, by_subject: {} };
    }
    var total = exam.questions.length;
    var correct = 0;
    var bySubject = {};
    exam.questions.forEach(function (q, i) {
      var subj = (q.topic || "Subject").replace(/\s*\(\d{4}\)\s*$/, "").trim() || "Subject";
      if (!bySubject[subj]) bySubject[subj] = { correct: 0, total: 0 };
      bySubject[subj].total++;
      var chosen = answerSheet[i];
      var key = String(chosen || "").toUpperCase();
      var ans = String(q.correct_option || "").toUpperCase();
      if (key && key === ans) {
        correct++;
        bySubject[subj].correct++;
      }
    });
    return {
      correct: correct,
      wrong: total - correct,
      total: total,
      score_percent: total ? (correct / total) * 100 : 0,
      by_subject: bySubject,
    };
  }

  window.loadPortalPracticeExams = loadPortalPracticeExams;
  window.beginPortalExam = beginPortalExam;
  window.scorePortalExam = scorePortalExam;
  window.isPortalExamId = function (id) {
    var s = String(id || "");
    return s.indexOf("portal:") === 0 || s.indexOf("aloc:") === 0;
  };
  window.JAMB_COMBINED_ID = JAMB_COMBINED_ID;
  window.listPortalBankSubjects = async function (examType) {
    var pool = await fetchPracticePool(resolveCategory(examType || "JAMB"));
    return pool.map(function (e) { return e.subject; });
  };
})();
