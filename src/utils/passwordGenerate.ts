export const generatePassword = (length: number, uppercase: boolean, lowercase: boolean, numbers: boolean, symbols: boolean) => {
    const uppercaseChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercaseChars = 'abcdefghijklmnopqrstuvwxyz';
    const numberChars = '0123456789';
    const symbolChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const allChars = uppercaseChars + lowercaseChars + numberChars + symbolChars;
    let chars = '';
    if (uppercase) {
        chars += uppercaseChars;
    }
    if (lowercase) {
        chars += lowercaseChars;
    }
    if (numbers) {
        chars += numberChars;
    }
    if (symbols) {
        chars += symbolChars;
    }
    if (chars === '') {
        chars = allChars;
    }
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}