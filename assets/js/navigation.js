// Full-screen navigation functionality
(function() {
    let currentScreen = 0;
    let screens = [];
    let isScrolling = false;

    function init() {
        screens = document.querySelectorAll('.screen');

        if (screens.length === 0) {
            window.DEBUG && console.warn('No .screen elements found');
            return;
        }

        // Create navigation arrows
        createNavigationArrows();

        // Update current screen on scroll
        window.addEventListener('scroll', updateCurrentScreen);

        // Initial update
        updateCurrentScreen();

        // Highlight navigation arrows after 5 seconds (only on first screen)
        setTimeout(function() {
            if (currentScreen === 0) {
                highlightNavigation();
            }
        }, 5000);
    }

    function createNavigationArrows() {
        const navContainer = document.createElement('div');
        navContainer.className = 'nav-arrows';

        const upArrow = document.createElement('div');
        upArrow.className = 'nav-arrow up';
        upArrow.setAttribute('aria-label', 'Previous section');
        upArrow.addEventListener('click', function() {
            navigateToScreen(currentScreen - 1);
        });

        const downArrow = document.createElement('div');
        downArrow.className = 'nav-arrow down';
        downArrow.setAttribute('aria-label', 'Next section');
        downArrow.addEventListener('click', function() {
            navigateToScreen(currentScreen + 1);
        });

        navContainer.appendChild(upArrow);
        navContainer.appendChild(downArrow);
        document.body.appendChild(navContainer);
    }

    function navigateToScreen(index) {
        if (index < 0 || index >= screens.length || index === currentScreen) {
            return;
        }

        isScrolling = true;
        currentScreen = index;

        screens[index].scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });

        updateArrows();

        setTimeout(function() {
            isScrolling = false;
        }, 1000);
    }

    function updateCurrentScreen() {
        const scrollPosition = window.scrollY + (window.innerHeight / 2);

        let previousScreen = currentScreen;

        screens.forEach(function(screen, index) {
            const screenTop = screen.offsetTop;
            const screenBottom = screenTop + screen.offsetHeight;

            if (scrollPosition >= screenTop && scrollPosition < screenBottom) {
                currentScreen = index;
            }
        });

        // Pause/resume animation based on screen visibility
        if (previousScreen !== currentScreen) {
            if (currentScreen === 0) {
                // Resumed to first screen - resume animation
                if (window.resumeAnimation) {
                    window.resumeAnimation();
                }
            } else if (previousScreen === 0) {
                // Left first screen - pause animation
                if (window.pauseAnimation) {
                    window.pauseAnimation();
                }
            }
        }

        updateArrows();
    }

    function updateArrows() {
        const upArrow = document.querySelector('.nav-arrow.up');
        const downArrow = document.querySelector('.nav-arrow.down');

        if (!upArrow || !downArrow) return;

        if (currentScreen === 0) {
            upArrow.classList.add('disabled');
        } else {
            upArrow.classList.remove('disabled');
        }

        if (currentScreen === screens.length - 1) {
            downArrow.classList.add('disabled');
        } else {
            downArrow.classList.remove('disabled');
        }
    }

    function highlightNavigation() {
        const navContainer = document.querySelector('.nav-arrows');
        if (!navContainer) return;

        navContainer.classList.add('highlight');

        // Remove highlight after animation completes (3 pulses × 1s each)
        setTimeout(function() {
            navContainer.classList.remove('highlight');
        }, 3000);
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

// Research card expand/collapse functionality
(function() {
    function init() {
        const researchCards = document.querySelectorAll('.research-card');

        researchCards.forEach(function(card) {
            // Add click listener to the card (but not the link)
            card.addEventListener('click', function(e) {
                // Don't toggle if clicking on the paper link
                if (e.target.classList.contains('research-card-link') ||
                    e.target.closest('.research-card-link')) {
                    return;
                }

                e.preventDefault();
                toggleCard(card);
            });

            // Add click listener specifically to the toggle button
            const toggleButton = card.querySelector('.research-card-toggle');
            if (toggleButton) {
                toggleButton.addEventListener('click', function(e) {
                    e.stopPropagation();
                    toggleCard(card);
                });
            }
        });
    }

    function toggleCard(card) {
        const isExpanded = card.getAttribute('data-expanded') === 'true';
        const expandableContent = card.querySelector('.research-card-expandable');

        if (!expandableContent) return;

        // Toggle the expanded state
        card.setAttribute('data-expanded', (!isExpanded).toString());

        // Add accessibility attributes
        const toggleButton = card.querySelector('.research-card-toggle');
        if (toggleButton) {
            toggleButton.setAttribute('aria-expanded', (!isExpanded).toString());
            toggleButton.setAttribute('aria-label', isExpanded ? 'Expand card' : 'Collapse card');
        }

        // Update expandable content max-height for smooth animation
        if (!isExpanded) {
            // Expanding: set max-height to the scroll height
            expandableContent.style.maxHeight = expandableContent.scrollHeight + 'px';
        } else {
            // Collapsing: set max-height to 0
            expandableContent.style.maxHeight = '0px';
        }

        // Reset max-height after animation completes to handle dynamic content
        setTimeout(function() {
            if (!isExpanded) {
                expandableContent.style.maxHeight = 'none';
            }
        }, 350);
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
