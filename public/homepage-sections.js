(function () {
  function normalizeHomepageSections(raw) {
    let sections = raw;

    if (typeof sections === 'string') {
      try {
        sections = JSON.parse(sections);
      } catch {
        sections = [sections];
      }
    }

    if (!Array.isArray(sections)) {
      sections = [sections];
    }

    sections = sections
      .map(section => (typeof section === 'string' ? section.trim().toLowerCase() : ''))
      .filter(Boolean);

    return sections.length ? sections : ['konular'];
  }

  function getHomepageSections(settings, isDesktop) {
    const mobileSections = normalizeHomepageSections(settings?.homepage_sections);
    const desktopSections = settings?.homepage_sections_desktop;
    if (!isDesktop || desktopSections == null || desktopSections === '') return mobileSections;
    return normalizeHomepageSections(desktopSections);
  }

  if (typeof window !== 'undefined') {
    window.normalizeHomepageSections = normalizeHomepageSections;
    window.getHomepageSections = getHomepageSections;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeHomepageSections, getHomepageSections };
  }
})();
