document.addEventListener('DOMContentLoaded', async () => {
    // Initialize navigation if available (sets up sidebar, etc.)
    const navigation = typeof GRASPNavigation !== 'undefined' ? new GRASPNavigation() : null;

    // UI Elements
    const quizSelector = document.getElementById('quiz-selector');
    const searchInput = document.getElementById('student-search');
    const tableBody = document.getElementById('scores-table-body');
    const paginationContainer = document.getElementById('pagination-container');
    const paginationInfo = document.getElementById('pagination-info');
    const paginationControls = document.getElementById('pagination-controls');

    // State Variables
    let currentThemeQuizzes = [];
    let currentScoresRaw = []; // raw fetched from API
    let currentScoresFiltered = []; // after search
    let currentPage = 1;
    const ITEMS_PER_PAGE = 15;

    // Formatting helpers
    const formatTime = (ms) => {
        if (!ms) return '-';
        const seconds = Math.floor((ms / 1000) % 60);
        const minutes = Math.floor((ms / (1000 * 60)) % 60);
        const hours = Math.floor((ms / (1000 * 60 * 60)));
        
        let formatted = '';
        if (hours > 0) formatted += `${hours}h `;
        if (minutes > 0 || hours > 0) formatted += `${minutes}m `;
        formatted += `${seconds}s`;
        return formatted;
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleString(undefined, { 
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    const getScoreClass = (score) => {
        if (score >= 80) return 'score-high';
        if (score >= 60) return 'score-medium';
        return 'score-low';
    };

    const showLoadingTable = () => {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="loading-spinner">
                        <i class="fas fa-circle-notch"></i>
                        <p>Loading scores...</p>
                    </div>
                </td>
            </tr>
        `;
        paginationContainer.style.display = 'none';
    };

    const showEmptyTable = (message) => {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="empty-state">
                        <i class="fas fa-inbox"></i>
                        <h3>No Data</h3>
                        <p>${message}</p>
                    </div>
                </td>
            </tr>
        `;
        paginationContainer.style.display = 'none';
    };

    // Rendering Logic
    const renderTable = () => {
        tableBody.innerHTML = '';

        if (currentScoresFiltered.length === 0) {
            showEmptyTable('No student scores matched your filters.');
            return;
        }

        // Pagination calculations
        const totalPages = Math.ceil(currentScoresFiltered.length / ITEMS_PER_PAGE);
        if (currentPage > totalPages) currentPage = 1;
        
        const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
        const endIdx = startIdx + ITEMS_PER_PAGE;
        const pageData = currentScoresFiltered.slice(startIdx, endIdx);

        // Update pagination info
        paginationInfo.textContent = `Showing ${startIdx + 1} to ${Math.min(endIdx, currentScoresFiltered.length)} of ${currentScoresFiltered.length} entries`;
        
        // Render pagination controls
        renderPaginationControls(totalPages);
        paginationContainer.style.display = 'flex';

        // Render rows
        pageData.forEach(item => {
            const tr = document.createElement('tr');
            
            const nameTd = document.createElement('td');
            nameTd.textContent = item.studentName || 'Unknown Student';
            nameTd.style.fontWeight = '600';

            const emailTd = document.createElement('td');
            emailTd.textContent = item.studentEmail || '-';

            const scoreTd = document.createElement('td');
            const scoreSpan = document.createElement('span');
            if (item.score !== undefined && item.score !== null) {
                scoreSpan.className = `score-badge ${getScoreClass(item.score)}`;
                scoreSpan.textContent = `${Number(item.score).toFixed(1)}%`;
            } else {
                scoreSpan.className = 'score-badge';
                scoreSpan.style.backgroundColor = '#f1f5f9';
                scoreSpan.style.color = '#64748b';
                scoreSpan.textContent = 'Not Taken';
            }
            scoreTd.appendChild(scoreSpan);

            const ratioTd = document.createElement('td');
            ratioTd.textContent = item.correctAnswers != null ? `${item.correctAnswers} / ${item.totalQuestions}` : '-';

            const timeTd = document.createElement('td');
            timeTd.textContent = formatTime(item.timeSpent);

            const dateTd = document.createElement('td');
            dateTd.textContent = formatDate(item.completedAt);

            tr.appendChild(nameTd);
            tr.appendChild(emailTd);
            tr.appendChild(scoreTd);
            tr.appendChild(ratioTd);
            tr.appendChild(timeTd);
            tr.appendChild(dateTd);
            
            if (item.score !== undefined && item.score !== null) {
                tr.classList.add('student-row');
                tr.title = "Click to review student answers";
                tr.addEventListener('click', () => {
                    const quizId = document.getElementById('quiz-selector').value;
                    fetchAndRenderStudentReview(quizId, item.userId, item.studentName || 'Unknown Student', item.score);
                });
            }

            tableBody.appendChild(tr);
        });
    };

    // Modal UI Logic
    const reviewModal = document.getElementById("student-review-modal");
    const closeReviewBtn = document.getElementById("close-review-btn");
    const reviewSummary = document.getElementById("review-summary");
    const reviewQuestionsContainer = document.getElementById("review-questions-container");
    const reviewStudentName = document.getElementById("review-student-name");
    
    closeReviewBtn.addEventListener("click", () => {
        reviewModal.style.display = "none";
    });

    window.addEventListener("click", (e) => {
        if (e.target === reviewModal) {
            reviewModal.style.display = "none";
        }
    });

    const escapeHtml = (unsafe) => {
        return (unsafe || "").toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };

    const renderKatex = () => {
        if (typeof renderMathInElement !== 'undefined') {
            renderMathInElement(document.body, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false},
                    {left: '\\(', right: '\\)', display: false},
                    {left: '\\[', right: '\\]', display: true}
                ],
                throwOnError: false
            });
        }
    };

    const QUESTION_TYPES = {
        MULTIPLE_CHOICE: 'multiple-choice',
        FILL_IN_THE_BLANK: 'fill-in-the-blank',
        CALCULATION: 'calculation',
        OPEN_ENDED: 'open-ended',
    };

    const renderTextAnswerBlock = (attempt) => {
        const isCalculation = attempt.questionType === QUESTION_TYPES.CALCULATION;
        const studentAnswer = attempt.selectedAnswer
            ? escapeHtml(attempt.selectedAnswer)
            : '<em style="color:#95a5a6;">Not recorded</em>';

        const correctAnswer = attempt.correctAnswer
            ? escapeHtml(attempt.correctAnswer)
            : null;

        const answerClass = attempt.isCorrect ? 'review-text-value--correct' : 'review-text-value--incorrect';

        let html = `
            <div class="review-text-answer">
                <div class="review-text-row">
                    <span class="review-text-label">Student's Answer:</span>
                    <span class="review-text-value ${answerClass}">${studentAnswer}</span>
                </div>`;

        // For calculation, always show the correct answer; for others, only when wrong
        if (correctAnswer && (isCalculation || !attempt.isCorrect)) {
            html += `
                <div class="review-text-row">
                    <span class="review-text-label">Correct Answer:</span>
                    <span class="review-text-value review-text-value--correct">${correctAnswer}</span>
                </div>`;
        }

        html += `</div>`;
        return html;
    };

    const renderOpenEndedBlock = (attempt) => {
        const studentAnswer = attempt.selectedAnswer
            ? escapeHtml(attempt.selectedAnswer)
            : '<em style="color:#95a5a6;">Not recorded</em>';

        const sampleAnswer = attempt.openEndedSampleAnswer
            ? escapeHtml(attempt.openEndedSampleAnswer)
            : '<em style="color:#95a5a6;">No sample answer provided.</em>';

        const gradingCriteria = attempt.openEndedGradingCriteria
            ? escapeHtml(attempt.openEndedGradingCriteria)
            : '<em style="color:#95a5a6;">No grading criteria provided.</em>';

        return `
            <div class="review-text-answer">
                <div class="review-text-row">
                    <span class="review-text-label">Student's Response:</span>
                    <span class="review-text-value">${studentAnswer}</span>
                </div>
            </div>
            <div class="review-open-ended-panel">
                <div class="review-open-ended-section">
                    <strong>Sample Answer:</strong>
                    <p>${sampleAnswer}</p>
                </div>
                <div class="review-open-ended-section">
                    <strong>Grading Criteria:</strong>
                    <p>${gradingCriteria}</p>
                </div>
            </div>`;
    };

    const renderMultipleChoiceBlock = (attempt) => {
        const dbKeys = ['A', 'B', 'C', 'D'];
        let optionsHtml = '';

        dbKeys.forEach(key => {
            const optionRaw = attempt.options[key];
            const optionText = typeof optionRaw === 'object' && optionRaw !== null ? (optionRaw.text || "") : (optionRaw || "");
            if (!optionText) return;

            let classes = "review-option";
            if (key === attempt.correctAnswer) {
                classes += " correct";
            } else if (key === attempt.selectedAnswer && !attempt.isCorrect) {
                classes += " incorrect";
            }

            if (!attempt.selectedAnswer && !attempt.isCorrect && key !== attempt.correctAnswer) {
                classes = "review-option";
            }

            optionsHtml += `
                <div class="${classes}">
                    <div class="review-option-letter">${key}</div>
                    <div class="review-option-text">${window.parseSmilesTags ? window.parseSmilesTags(escapeHtml(optionText)) : escapeHtml(optionText)}</div>
                </div>
            `;
        });

        return `<div class="review-options">${optionsHtml}</div>`;
    };

    const fetchAndRenderStudentReview = async (quizId, userId, studentName, score) => {
        reviewStudentName.textContent = `Review: ${studentName}`;
        reviewSummary.innerHTML = `<p>Loading attempt data...</p>`;
        reviewQuestionsContainer.innerHTML = '';
        reviewModal.style.display = "flex";

        try {
            const response = await fetch(`/api/quiz/${quizId}/student/${userId}/attempts`);
            const data = await response.json();

            if (!data.success || !data.data) {
                throw new Error("Could not fetch attempt data.");
            }

            const attempts = data.data;
            if (attempts.length === 0) {
                reviewSummary.innerHTML = `<p>No recorded questions found for this attempt.</p>`;
                return;
            }

            const openEndedAttempts = attempts.filter(a => a.questionType === QUESTION_TYPES.OPEN_ENDED);
            const gradedAttempts = attempts.filter(a => a.questionType !== QUESTION_TYPES.OPEN_ENDED);
            const correctCount = gradedAttempts.filter(a => a.isCorrect).length;
            const totalGraded = gradedAttempts.length;
            const openEndedCount = openEndedAttempts.length;

            let summaryHtml = `<div style="font-size: 16px; color: #2c3e50; display: flex; flex-wrap: wrap; gap: 15px; align-items: center;">
                <span><strong>Score:</strong> <span class="score-badge ${getScoreClass(score)}">${Number(score).toFixed(1)}%</span></span>`;

            if (totalGraded > 0) {
                summaryHtml += `<span><strong>Auto-graded:</strong> ${correctCount} / ${totalGraded} correct</span>`;
            }
            if (openEndedCount > 0) {
                summaryHtml += `<span class="review-badge-pending"><i class="fas fa-pencil-alt"></i> ${openEndedCount} open-ended — manual grading required</span>`;
            }

            summaryHtml += `</div>`;
            reviewSummary.innerHTML = summaryHtml;

            attempts.forEach((attempt, index) => {
                const qDiv = document.createElement("div");
                const isOpenEnded = attempt.questionType === QUESTION_TYPES.OPEN_ENDED;
                qDiv.className = `review-question${isOpenEnded ? ' review-question--open-ended' : ''}`;

                const questionTypeLabel = {
                    [QUESTION_TYPES.MULTIPLE_CHOICE]: 'Multiple Choice',
                    [QUESTION_TYPES.FILL_IN_THE_BLANK]: 'Fill in the Blank',
                    [QUESTION_TYPES.CALCULATION]: 'Calculation',
                    [QUESTION_TYPES.OPEN_ENDED]: 'Open-ended',
                }[attempt.questionType] || 'Multiple Choice';

                let statusBadge;
                if (isOpenEnded) {
                    statusBadge = `<span class="review-badge-pending"><i class="fas fa-clock"></i> Needs Manual Grading</span>`;
                } else if (attempt.isCorrect) {
                    statusBadge = `<span style="color: #2ecc71;"><i class="fas fa-check-circle"></i> Correct</span>`;
                } else {
                    statusBadge = `<span style="color: #e74c3c;"><i class="fas fa-times-circle"></i> Incorrect</span>`;
                    if (!attempt.selectedAnswer && attempt.questionType === QUESTION_TYPES.MULTIPLE_CHOICE) {
                        statusBadge += ` <span style="color: #95a5a6; font-size: 0.8em; font-weight: normal; margin-left: 10px;">(Exact answer wasn't logged)</span>`;
                    }
                }

                let bodyHtml;
                if (isOpenEnded) {
                    bodyHtml = renderOpenEndedBlock(attempt);
                } else if (attempt.questionType === QUESTION_TYPES.FILL_IN_THE_BLANK || attempt.questionType === QUESTION_TYPES.CALCULATION) {
                    bodyHtml = renderTextAnswerBlock(attempt);
                } else {
                    bodyHtml = renderMultipleChoiceBlock(attempt);
                }

                const questionTitle = window.parseSmilesTags
                    ? window.parseSmilesTags(escapeHtml(attempt.questionText))
                    : escapeHtml(attempt.questionText);

                qDiv.innerHTML = `
                    <div class="review-question-header">
                        <span>Question ${index + 1} <span class="review-question-type-label">${questionTypeLabel}</span></span>
                        ${statusBadge}
                    </div>
                    <div class="review-question-title">${questionTitle}</div>
                    ${bodyHtml}
                `;
                reviewQuestionsContainer.appendChild(qDiv);
            });

            if (typeof renderKatex === 'function') {
                renderKatex();
            }
            if (typeof renderSmiles === 'function') {
                renderSmiles();
            }
        } catch(e) {
            console.error("Error fetching review:", e);
            reviewSummary.innerHTML = `<p style="color: red;">Failed to load attempt data.</p>`;
        }
    };

    const renderPaginationControls = (totalPages) => {
        paginationControls.innerHTML = '';
        
        if (totalPages <= 1) {
            paginationControls.style.display = 'none';
            return;
        }
        
        paginationControls.style.display = 'flex';

        // Prev btn
        const prevBtn = document.createElement('button');
        prevBtn.className = 'page-btn';
        prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
        prevBtn.disabled = currentPage === 1;
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderTable();
            }
        });
        paginationControls.appendChild(prevBtn);

        // Page numbers
        // Simple logic for < 7 pages, show all
        let startPage = 1;
        let endPage = totalPages;

        if (totalPages > 7) {
            startPage = Math.max(1, currentPage - 2);
            endPage = Math.min(totalPages, currentPage + 2);

            // Adjust window if near ends
            if (currentPage <= 3) { endPage = 5; }
            if (currentPage >= totalPages - 2) { startPage = totalPages - 4; }
        }

        if (startPage > 1) {
            const btn = createPageButton(1);
            paginationControls.appendChild(btn);
            if (startPage > 2) {
                const ellipsis = document.createElement('span');
                ellipsis.textContent = '...';
                ellipsis.style.padding = '8px 4px';
                paginationControls.appendChild(ellipsis);
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            const btn = createPageButton(i);
            paginationControls.appendChild(btn);
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                const ellipsis = document.createElement('span');
                ellipsis.textContent = '...';
                ellipsis.style.padding = '8px 4px';
                paginationControls.appendChild(ellipsis);
            }
            const btn = createPageButton(totalPages);
            paginationControls.appendChild(btn);
        }

        // Next btn
        const nextBtn = document.createElement('button');
        nextBtn.className = 'page-btn';
        nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                renderTable();
            }
        });
        paginationControls.appendChild(nextBtn);
    };

    const createPageButton = (pageNum) => {
        const btn = document.createElement('button');
        btn.className = `page-btn ${pageNum === currentPage ? 'active' : ''}`;
        btn.textContent = pageNum;
        btn.addEventListener('click', () => {
            currentPage = pageNum;
            renderTable();
        });
        return btn;
    };

    // Filter Logic
    const applyFilter = () => {
        const query = searchInput.value.trim().toLowerCase();
        
        if (!query) {
            currentScoresFiltered = [...currentScoresRaw];
        } else {
            currentScoresFiltered = currentScoresRaw.filter(s => {
                const name = (s.studentName || '').toLowerCase();
                const email = (s.studentEmail || '').toLowerCase();
                return name.includes(query) || email.includes(query);
            });
        }
        
        currentPage = 1;
        renderTable();
    };

    // Data Fetching
    const fetchScoresForQuiz = async (quizId) => {
        if (!quizId) {
            tableBody.innerHTML = '';
            showEmptyTable('Please select a quiz to view scores.');
            return;
        }

        showLoadingTable();
        
        try {
            const response = await fetch(`/api/quiz/${quizId}/scores`);
            const data = await response.json();
            
            if (data.success) {
                currentScoresRaw = data.data || [];
                applyFilter(); // this will also render
            } else {
                throw new Error(data.error || 'Failed to fetch scores');
            }
        } catch (error) {
            console.error('Error fetching quiz scores:', error);
            showEmptyTable('Error communicating with the server.');
        }
    };

    // Initialization
    const initPage = async () => {
        // Find course ID
        let courseId = null;
        try {
            const sessionCourse = JSON.parse(sessionStorage.getItem('grasp-selected-course') || '{}');
            if (sessionCourse && sessionCourse.id) {
                courseId = sessionCourse.id;
            }
        } catch(e) {}

        if (!courseId) {
            quizSelector.innerHTML = '<option value="">No course selected</option>';
            showEmptyTable('Please select a course from the sidebar.');
            return;
        }

        try {
            // Fetch quizzes for course
            const response = await fetch(`/api/quiz/course/${courseId}`);
            const data = await response.json();
            
            if (data.success && data.quizzes && data.quizzes.length > 0) {
                quizSelector.innerHTML = '';
                currentThemeQuizzes = data.quizzes;

                // Sort purely descending by createdAt if needed, but backend gives sorted.
                data.quizzes.forEach(quiz => {
                    const opt = document.createElement('option');
                    opt.value = quiz._id;
                    opt.textContent = quiz.name;
                    quizSelector.appendChild(opt);
                });

                // Default triggers load for most recently created (which is the first one in list)
                fetchScoresForQuiz(quizSelector.value);

            } else {
                quizSelector.innerHTML = '<option value="">No quizzes found for this course</option>';
                showEmptyTable('There are no quizzes associated with this course.');
            }
        } catch (error) {
            console.error('Error loading initial data:', error);
            quizSelector.innerHTML = '<option value="">Error loading</option>';
        }
    };

    // Listeners
    quizSelector.addEventListener('change', (e) => {
        fetchScoresForQuiz(e.target.value);
    });

    searchInput.addEventListener('input', applyFilter);

    // Bootstrap
    initPage();
});
