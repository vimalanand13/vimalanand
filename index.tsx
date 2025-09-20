import { GoogleGenAI, Chat } from "@google/genai";

// --- DOM element references ---
const profileSelector = document.getElementById('profile-selector')!;
const app = document.getElementById('app')!;
const chatHistory = document.getElementById('chat-history')!;
const chatForm = document.getElementById('chat-form')!;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
const sendButton = document.getElementById('send-button') as HTMLButtonElement;
const attachButton = document.getElementById('attach-button') as HTMLButtonElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const filePreviewContainer = document.getElementById('file-preview-container')!;
const transactionView = document.getElementById('transaction-view')!;
const closeModalButton = document.getElementById('close-modal-button')!;
const transactionTableBody = document.querySelector('#transaction-table tbody') as HTMLTableSectionElement;


// --- App State ---
let chat: Chat;
let userProfile: string | null = null;
let uploadedFile: File | null = null;
interface Transaction {
    date: string;
    description: string;
    amount: number;
}
let transactions: Transaction[] = [];


const suggestedPrompts = {
    Student: ["How do I build credit?", "Budgeting tips for students", "Should I start investing?"],
    Professional: ["How to save for a house?", "401(k) vs. IRA", "Understanding my taxes"],
    Retiree: ["Managing retirement income", "Estate planning basics", "Minimizing taxes in retirement"]
};


/**
 * Initializes the Gemini Chat instance with a profile-specific system instruction.
 */
const initializeChat = () => {
    try {
        if (!process.env.API_KEY) {
            throw new Error("API_KEY environment variable not set.");
        }
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        const systemInstruction = `You are a friendly and knowledgeable personal finance assistant called "FinBot".
Your goal is to provide helpful guidance on savings, taxes, and investments.
You MUST tailor your advice to the user's specified profile: **${userProfile}**.
When a user asks a question about an uploaded CSV file, use the information provided in the prompt to answer.
Keep your answers concise, clear, and easy to understand.
Start the conversation by introducing yourself and acknowledging the user's profile.
IMPORTANT: Always include this disclaimer at the end of every response: "Disclaimer: I am an AI assistant. This information is for educational purposes only. Please consult with a qualified financial advisor before making any financial decisions."`;

        chat = ai.chats.create({
            model: 'gemini-2.5-flash',
            config: {
                systemInstruction: systemInstruction,
            },
        });
    } catch (error) {
        console.error(error);
        addMessage('model', `<strong>Error:</strong> ${(error as Error).message}. Please ensure your API key is set up correctly and refresh the page.`);
    }
};

/**
 * Appends a message to the chat history.
 * @param {string} sender - 'user' or 'model'.
 * @param {string} text - The message content (can be HTML).
 * @returns {HTMLElement} The created message element.
 */
const addMessage = (sender: 'user' | 'model', text: string): HTMLElement => {
    const messageWrapper = document.createElement('div');
    messageWrapper.classList.add('message-wrapper', sender);

    let messageHTML = '';
    if (sender === 'model') {
        messageHTML += '<div class="avatar">🤖</div>';
    }
    messageHTML += `<div class="message ${sender}">${text}</div>`;

    messageWrapper.innerHTML = messageHTML;
    chatHistory.appendChild(messageWrapper);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return messageWrapper.querySelector('.message') as HTMLElement;
};

/**
 * Renders suggested prompt buttons based on the user's profile.
 */
const renderSuggestedPrompts = () => {
    const prompts = suggestedPrompts[userProfile as keyof typeof suggestedPrompts] || [];
    if (prompts.length === 0) return;

    const container = document.createElement('div');
    container.classList.add('message-wrapper', 'model');
    
    let buttonsHTML = '<div class="avatar">🤖</div><div class="message model"><div class="suggested-prompts">';
    prompts.forEach(prompt => {
        buttonsHTML += `<button class="prompt-button">${prompt}</button>`;
    });
    buttonsHTML += '</div></div>';
    
    container.innerHTML = buttonsHTML;
    chatHistory.appendChild(container);
    chatHistory.scrollTop = chatHistory.scrollHeight;
};


/**
 * Handles sending a message to the AI and streaming the response.
 * @param {string} messageText - The text of the message to send.
 */
const sendMessage = async (messageText: string) => {
    if (!messageText.trim()) return;

    setFormState(true);

    let prompt = messageText;
    let userDisplayMessage = messageText;

    if (uploadedFile && transactions.length > 0) {
        const totalIncome = transactions.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
        const totalExpenses = transactions.filter(t => t.amount < 0).reduce((sum, t) => sum + t.amount, 0);
        const summary = `The user has uploaded a CSV with ${transactions.length} transactions. Total income: ${totalIncome.toFixed(2)}, Total expenses: ${Math.abs(totalExpenses).toFixed(2)}.`;
        prompt = `${summary}\n\nPlease answer the user's question based on this data: "${messageText}"`;
    }
    
    addMessage('user', userDisplayMessage);
    chatInput.value = '';

    const modelMessageElement = addMessage('model',
      `<div class="loading-indicator"></div><div class="loading-indicator"></div><div class="loading-indicator"></div>`
    );

    try {
        const result = await chat.sendMessageStream({ message: prompt });
        let fullResponse = '';
        modelMessageElement.innerHTML = ''; 

        for await (const chunk of result) {
            fullResponse += chunk.text;
            const formattedText = fullResponse
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\n/g, '<br>');
            modelMessageElement.innerHTML = formattedText;
            chatHistory.scrollTop = chatHistory.scrollHeight;
        }

        if (chatHistory.querySelectorAll('.message.user').length === 1) {
           renderSuggestedPrompts();
        }

    } catch (error) {
        console.error("Error sending message:", error);
        modelMessageElement.innerHTML = "Sorry, something went wrong. Please try again.";
    } finally {
        setFormState(false);
    }
};

/**
 * Toggles the form's disabled state.
 * @param {boolean} isLoading - Whether the form should be in a loading state.
 */
const setFormState = (isLoading: boolean) => {
    chatInput.disabled = isLoading;
    sendButton.disabled = isLoading;
    attachButton.disabled = isLoading;
};

/**
 * Resets the file input and associated state.
 */
const resetFileInput = () => {
    uploadedFile = null;
    transactions = [];
    fileInput.value = '';
    filePreviewContainer.style.display = 'none';
    filePreviewContainer.innerHTML = '';
};

/**
 * Parses CSV content into an array of Transaction objects.
 * @param {string} csvContent - The raw CSV string.
 */
const parseCSV = (csvContent: string) => {
    transactions = [];
    const lines = csvContent.split('\n').slice(1); // Skip header row
    for (const line of lines) {
        if (line.trim() === '') continue;
        const parts = line.split(',');
        if (parts.length >= 3) {
            const date = parts[0].trim();
            const description = parts[1].trim();
            const amount = parseFloat(parts[2].trim());
            if (date && description && !isNaN(amount)) {
                transactions.push({ date, description, amount });
            }
        }
    }
};

/**
 * Renders the parsed transactions into the modal table.
 */
const renderTransactionsTable = () => {
    transactionTableBody.innerHTML = '';
    if (transactions.length === 0) {
        transactionTableBody.innerHTML = '<tr><td colspan="3">No transactions found in the file.</td></tr>';
        return;
    }

    for (const trx of transactions) {
        const row = document.createElement('tr');
        const amountClass = trx.amount >= 0 ? 'amount-positive' : 'amount-negative';
        const formattedAmount = trx.amount.toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
        });

        row.innerHTML = `
            <td>${trx.date}</td>
            <td>${trx.description}</td>
            <td class="${amountClass}">${formattedAmount}</td>
        `;
        transactionTableBody.appendChild(row);
    }
};

/**
 * Adds a bot message with a button to view the parsed transactions.
 */
const addTransactionAnalysisMessage = () => {
    const message = transactions.length > 0
        ? `I've analyzed your CSV file with ${transactions.length} transactions. You can view them or ask me questions about the data.`
        : `I couldn't find any valid transactions in your CSV. Please check the format (e.g., Date,Description,Amount) and try again.`;

    const messageWrapper = addMessage('model', message);
    if (transactions.length > 0) {
        const button = document.createElement('button');
        button.textContent = 'View Transactions';
        button.className = 'prompt-button view-transactions-button';
        messageWrapper.appendChild(button);
    }
};

/**
 * Handles the file selection, preview, and parsing.
 * @param {Event} event - The file input change event.
 */
const handleFileSelect = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
        uploadedFile = file;
        filePreviewContainer.innerHTML = `
            <div class="file-preview">
                <span>${file.name}</span>
                <button id="remove-file-button" aria-label="Remove file">&times;</button>
            </div>
        `;
        filePreviewContainer.style.display = 'block';

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            parseCSV(text);
            addTransactionAnalysisMessage();
        };
        reader.onerror = () => {
            addMessage('model', 'Sorry, there was an error reading your file.');
            resetFileInput();
        };
        reader.readAsText(file);
    }
};


// --- Initial Load & Event Listeners ---

document.querySelectorAll('.profile-buttons button').forEach(button => {
    button.addEventListener('click', async (e) => {
        userProfile = (e.currentTarget as HTMLElement).dataset.profile || null;
        if (userProfile) {
            profileSelector.classList.add('hidden');
            app.classList.remove('hidden');
            initializeChat();
            // Send initial message
            await sendMessage(`Hi! My profile is: ${userProfile}`);
        }
    });
});

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const messageText = chatInput.value;
    sendMessage(messageText);
});

chatHistory.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('prompt-button')) {
        if (target.classList.contains('view-transactions-button')) {
            renderTransactionsTable();
            transactionView.classList.remove('hidden');
        } else {
            chatInput.value = target.textContent || '';
            chatForm.dispatchEvent(new Event('submit', { bubbles: true }));
        }
    }
});

attachButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileSelect);

filePreviewContainer.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'remove-file-button') {
        resetFileInput();
    }
});

closeModalButton.addEventListener('click', () => {
    transactionView.classList.add('hidden');
});

transactionView.addEventListener('click', (e) => {
    if (e.target === transactionView) {
        transactionView.classList.add('hidden');
    }
});
