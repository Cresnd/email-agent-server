/**
 * AI-powered email classification system
 * Analyzes email content to categorize and extract intents
 */

export interface EmailContent {
  subject: string;
  body: string;
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  date: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
  }>;
}

export interface ClassificationResult {
  category: string;
  subcategory?: string;
  intent: string;
  confidence: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  urgency: 'normal' | 'urgent';
  requires_response: boolean;
  sentiment: 'positive' | 'negative' | 'neutral';
  language?: string;
  entities: Array<{
    type: string;
    value: string;
    confidence: number;
  }>;
  keywords: string[];
  suggested_actions: string[];
  reasoning?: string;
}

export interface ClassificationRule {
  id: string;
  name: string;
  category: string;
  patterns: {
    subject?: string[];
    body?: string[];
    from?: string[];
    keywords?: string[];
  };
  confidence_boost: number;
  priority_override?: 'low' | 'medium' | 'high' | 'urgent';
  active: boolean;
}

export class EmailClassifier {
  private rules: Map<string, ClassificationRule> = new Map();
  private categories: Map<string, any> = new Map();

  constructor() {
    this.initializeCategories();
    this.loadDefaultRules();
  }

  /**
   * Classify an email and return detailed classification results
   */
  async classify(email: EmailContent): Promise<ClassificationResult> {
    const startTime = Date.now();

    try {
      // Extract features from email
      const features = this.extractFeatures(email);

      // Apply rule-based classification
      const ruleResults = this.applyRules(email, features);

      // Apply AI-based classification
      const aiResults = await this.applyAIClassification(email, features);

      // Combine results
      const finalResult = this.combineResults(ruleResults, aiResults);

      // Add processing metadata
      finalResult.processing_time = Date.now() - startTime;

      return finalResult;

    } catch (error) {
      console.error('Email classification failed:', error);
      
      // Return fallback classification
      return this.getFallbackClassification(email);
    }
  }

  /**
   * Add or update a classification rule
   */
  addRule(rule: ClassificationRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Remove a classification rule
   */
  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  /**
   * Get all active rules
   */
  getActiveRules(): ClassificationRule[] {
    return Array.from(this.rules.values()).filter(rule => rule.active);
  }

  /**
   * Update rule patterns and weights
   */
  updateRule(ruleId: string, updates: Partial<ClassificationRule>): void {
    const existingRule = this.rules.get(ruleId);
    if (existingRule) {
      this.rules.set(ruleId, { ...existingRule, ...updates });
    }
  }

  // Private methods

  private initializeCategories(): void {
    this.categories.set('booking', {
      subcategories: ['new_booking', 'modification', 'cancellation', 'inquiry'],
      keywords: ['reservation', 'booking', 'table', 'dinner', 'lunch', 'party', 'guests'],
      priority: 'high'
    });

    this.categories.set('customer_service', {
      subcategories: ['complaint', 'compliment', 'question', 'feedback'],
      keywords: ['service', 'food', 'experience', 'staff', 'quality'],
      priority: 'medium'
    });

    this.categories.set('business', {
      subcategories: ['partnership', 'supplier', 'invoice', 'marketing'],
      keywords: ['business', 'partnership', 'supplier', 'invoice', 'marketing'],
      priority: 'low'
    });

    this.categories.set('spam', {
      subcategories: ['promotional', 'phishing', 'unknown'],
      keywords: ['offer', 'deal', 'click here', 'urgent', 'limited time'],
      priority: 'low'
    });
  }

  private loadDefaultRules(): void {
    // Booking-related rules
    this.addRule({
      id: 'booking_request',
      name: 'Booking Request Detection',
      category: 'booking',
      patterns: {
        subject: ['reservation', 'booking', 'table for'],
        body: ['book a table', 'make a reservation', 'party of', 'guests'],
        keywords: ['reservation', 'booking', 'table', 'party', 'guests', 'dinner', 'lunch']
      },
      confidence_boost: 0.8,
      priority_override: 'high',
      active: true
    });

    this.addRule({
      id: 'booking_cancellation',
      name: 'Booking Cancellation Detection',
      category: 'booking',
      patterns: {
        subject: ['cancel', 'cancellation', 'cancel reservation'],
        body: ['cancel my reservation', 'cancel my booking', 'need to cancel'],
        keywords: ['cancel', 'cancellation', 'unable to come', 'change of plans']
      },
      confidence_boost: 0.9,
      priority_override: 'urgent',
      active: true
    });

    // Customer service rules
    this.addRule({
      id: 'complaint',
      name: 'Customer Complaint Detection',
      category: 'customer_service',
      patterns: {
        subject: ['complaint', 'poor service', 'disappointed'],
        body: ['disappointed', 'poor service', 'terrible', 'awful', 'horrible'],
        keywords: ['complaint', 'disappointed', 'poor', 'terrible', 'awful', 'bad experience']
      },
      confidence_boost: 0.7,
      priority_override: 'urgent',
      active: true
    });

    this.addRule({
      id: 'compliment',
      name: 'Customer Compliment Detection',
      category: 'customer_service',
      patterns: {
        subject: ['thank you', 'great service', 'wonderful'],
        body: ['excellent', 'wonderful', 'amazing', 'fantastic', 'great service'],
        keywords: ['excellent', 'wonderful', 'amazing', 'fantastic', 'great', 'loved']
      },
      confidence_boost: 0.6,
      priority_override: 'medium',
      active: true
    });
  }

  private extractFeatures(email: EmailContent): any {
    const features = {
      subject_words: email.subject.toLowerCase().split(' ').filter(w => w.length > 2),
      body_words: email.body.toLowerCase().split(' ').filter(w => w.length > 2),
      word_count: email.body.split(' ').length,
      has_attachments: Boolean(email.attachments?.length),
      attachment_count: email.attachments?.length || 0,
      time_of_day: new Date(email.date).getHours(),
      day_of_week: new Date(email.date).getDay(),
      sender_domain: email.from.split('@')[1]?.toLowerCase(),
      is_reply: email.subject.toLowerCase().startsWith('re:'),
      is_forward: email.subject.toLowerCase().startsWith('fwd:'),
      urgency_indicators: this.findUrgencyIndicators(email),
      question_indicators: this.findQuestionIndicators(email),
      booking_indicators: this.findBookingIndicators(email),
      contact_info: this.extractContactInfo(email)
    };

    return features;
  }

  private applyRules(email: EmailContent, features: any): Partial<ClassificationResult> {
    let bestMatch: Partial<ClassificationResult> = {
      category: 'unknown',
      confidence: 0,
      priority: 'medium'
    };

    for (const rule of this.getActiveRules()) {
      const score = this.calculateRuleScore(email, features, rule);
      
      if (score > bestMatch.confidence!) {
        bestMatch = {
          category: rule.category,
          confidence: score,
          priority: rule.priority_override || 'medium',
          rule_matched: rule.name
        };
      }
    }

    return bestMatch;
  }

  private calculateRuleScore(email: EmailContent, features: any, rule: ClassificationRule): number {
    let score = 0;
    const emailText = (email.subject + ' ' + email.body).toLowerCase();

    // Check subject patterns
    if (rule.patterns.subject) {
      for (const pattern of rule.patterns.subject) {
        if (emailText.includes(pattern.toLowerCase())) {
          score += 0.3;
        }
      }
    }

    // Check body patterns
    if (rule.patterns.body) {
      for (const pattern of rule.patterns.body) {
        if (emailText.includes(pattern.toLowerCase())) {
          score += 0.4;
        }
      }
    }

    // Check sender patterns
    if (rule.patterns.from) {
      for (const pattern of rule.patterns.from) {
        if (email.from.toLowerCase().includes(pattern.toLowerCase())) {
          score += 0.2;
        }
      }
    }

    // Check keyword patterns
    if (rule.patterns.keywords) {
      for (const keyword of rule.patterns.keywords) {
        if (emailText.includes(keyword.toLowerCase())) {
          score += 0.1;
        }
      }
    }

    // Apply confidence boost
    score = Math.min(1.0, score * (1 + rule.confidence_boost));

    return score;
  }

  private async applyAIClassification(email: EmailContent, features: any): Promise<Partial<ClassificationResult>> {
    // TODO: Implement actual AI classification using OpenAI/Anthropic
    // For now, return mock AI results
    
    const mockCategories = ['booking', 'customer_service', 'business', 'spam'];
    const category = mockCategories[Math.floor(Math.random() * mockCategories.length)];
    
    return {
      category,
      confidence: 0.7 + Math.random() * 0.3,
      intent: this.inferIntent(email, category),
      sentiment: this.inferSentiment(email.body),
      entities: this.extractEntities(email),
      keywords: features.subject_words.slice(0, 5),
      language: 'en'
    };
  }

  private combineResults(ruleResults: Partial<ClassificationResult>, aiResults: Partial<ClassificationResult>): ClassificationResult {
    // Weighted combination of rule-based and AI results
    const ruleWeight = 0.6;
    const aiWeight = 0.4;

    const combinedConfidence = (
      (ruleResults.confidence || 0) * ruleWeight + 
      (aiResults.confidence || 0) * aiWeight
    );

    // Use higher confidence result for category
    const finalCategory = (ruleResults.confidence || 0) > (aiResults.confidence || 0) 
      ? ruleResults.category || 'unknown'
      : aiResults.category || 'unknown';

    return {
      category: finalCategory,
      intent: aiResults.intent || 'unknown',
      confidence: combinedConfidence,
      priority: ruleResults.priority || 'medium',
      urgency: this.determineUrgency(ruleResults, aiResults),
      requires_response: this.determineResponseRequired(finalCategory),
      sentiment: aiResults.sentiment || 'neutral',
      entities: aiResults.entities || [],
      keywords: aiResults.keywords || [],
      suggested_actions: this.suggestActions(finalCategory),
      reasoning: `Combined rule-based (${ruleResults.confidence?.toFixed(2)}) and AI (${aiResults.confidence?.toFixed(2)}) classification`
    };
  }

  private getFallbackClassification(email: EmailContent): ClassificationResult {
    return {
      category: 'unknown',
      intent: 'unknown',
      confidence: 0.1,
      priority: 'medium',
      urgency: 'normal',
      requires_response: true,
      sentiment: 'neutral',
      entities: [],
      keywords: [],
      suggested_actions: ['manual_review'],
      reasoning: 'Fallback classification due to processing error'
    };
  }

  private findUrgencyIndicators(email: EmailContent): string[] {
    const urgentWords = ['urgent', 'asap', 'emergency', 'immediately', 'critical', 'important'];
    const text = (email.subject + ' ' + email.body).toLowerCase();
    return urgentWords.filter(word => text.includes(word));
  }

  private findQuestionIndicators(email: EmailContent): string[] {
    const questionWords = ['what', 'when', 'where', 'who', 'why', 'how', 'can you', 'could you'];
    const text = (email.subject + ' ' + email.body).toLowerCase();
    return questionWords.filter(word => text.includes(word));
  }

  private findBookingIndicators(email: EmailContent): string[] {
    const bookingWords = ['reservation', 'booking', 'table', 'party', 'guests', 'dinner', 'lunch'];
    const text = (email.subject + ' ' + email.body).toLowerCase();
    return bookingWords.filter(word => text.includes(word));
  }

  private extractContactInfo(email: EmailContent): any {
    const phoneRegex = /\b\d{3}-\d{3}-\d{4}\b|\b\(\d{3}\)\s*\d{3}-\d{4}\b/g;
    const phones = email.body.match(phoneRegex) || [];
    
    return {
      phones,
      has_phone: phones.length > 0
    };
  }

  private inferIntent(email: EmailContent, category: string): string {
    const text = email.body.toLowerCase();
    
    switch (category) {
      case 'booking':
        if (text.includes('cancel')) return 'cancel_booking';
        if (text.includes('modify') || text.includes('change')) return 'modify_booking';
        if (text.includes('book') || text.includes('reservation')) return 'create_booking';
        return 'booking_inquiry';
        
      case 'customer_service':
        if (text.includes('complaint') || text.includes('disappointed')) return 'complaint';
        if (text.includes('thank') || text.includes('excellent')) return 'compliment';
        return 'general_inquiry';
        
      default:
        return 'unknown';
    }
  }

  private inferSentiment(text: string): 'positive' | 'negative' | 'neutral' {
    const positiveWords = ['great', 'excellent', 'wonderful', 'amazing', 'fantastic', 'love', 'thank'];
    const negativeWords = ['terrible', 'awful', 'horrible', 'disappointed', 'poor', 'bad', 'hate'];
    
    const lowerText = text.toLowerCase();
    const positiveScore = positiveWords.reduce((score, word) => 
      score + (lowerText.includes(word) ? 1 : 0), 0
    );
    const negativeScore = negativeWords.reduce((score, word) => 
      score + (lowerText.includes(word) ? 1 : 0), 0
    );

    if (positiveScore > negativeScore) return 'positive';
    if (negativeScore > positiveScore) return 'negative';
    return 'neutral';
  }

  private extractEntities(email: EmailContent): Array<{ type: string; value: string; confidence: number }> {
    const entities = [];
    
    // Extract dates (simple pattern matching)
    const datePattern = /\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{1,2}-\d{1,2}-\d{4}\b/g;
    const dates = email.body.match(datePattern) || [];
    dates.forEach(date => {
      entities.push({ type: 'date', value: date, confidence: 0.8 });
    });

    // Extract times
    const timePattern = /\b\d{1,2}:\d{2}\s*(am|pm|AM|PM)?\b/g;
    const times = email.body.match(timePattern) || [];
    times.forEach(time => {
      entities.push({ type: 'time', value: time, confidence: 0.7 });
    });

    // Extract numbers (potential party size)
    const numberPattern = /\bparty of (\d+)\b|\b(\d+) guests?\b/gi;
    const numbers = email.body.match(numberPattern) || [];
    numbers.forEach(num => {
      entities.push({ type: 'party_size', value: num, confidence: 0.9 });
    });

    return entities;
  }

  private determineUrgency(ruleResults: Partial<ClassificationResult>, aiResults: Partial<ClassificationResult>): 'normal' | 'urgent' {
    if (ruleResults.priority === 'urgent' || aiResults.priority === 'urgent') {
      return 'urgent';
    }
    return 'normal';
  }

  private determineResponseRequired(category: string): boolean {
    const responseRequiredCategories = ['booking', 'customer_service'];
    return responseRequiredCategories.includes(category);
  }

  private suggestActions(category: string): string[] {
    switch (category) {
      case 'booking':
        return ['check_availability', 'create_booking', 'send_confirmation'];
      case 'customer_service':
        return ['acknowledge_receipt', 'investigate_issue', 'provide_resolution'];
      case 'business':
        return ['forward_to_manager', 'schedule_meeting'];
      case 'spam':
        return ['mark_as_spam', 'block_sender'];
      default:
        return ['manual_review'];
    }
  }
}