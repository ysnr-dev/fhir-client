module Dpc
  # 判定に使う DPC 電子点数表の行を、版と基準日で引く。
  class Tables
    attr_reader :edition, :date

    def self.for(date)
      new(edition: Master::DpcEdition.for(date), date: date)
    end

    def initialize(edition:, date:)
      @edition = edition
      @date = date
      @cache = {}
    end

    def available?
      edition.present?
    end

    def mdc6_for(icd10)
      code = Master::DpcIcdCode.normalize_icd10(icd10)
      return [] if code.blank?

      Master::DpcIcdCode.lookup([code], on: date).fetch(code, []).map(&:mdc6).uniq
    end

    def classification_name(code)
      cached(:classification, code) { scoped(Master::DpcClassification).find_by(code: code)&.name }
    end

    def conditions(mdc6) = cached(:conditions, mdc6) { scoped(Master::DpcCondition).where(mdc6: mdc6).to_a }
    def surgeries(mdc6) = cached(:surgeries, mdc6) { scoped(Master::DpcSurgery).where(mdc6: mdc6).to_a }
    def comorbidities(mdc6) = cached(:comorbidities, mdc6) { scoped(Master::DpcComorbidity).where(mdc6: mdc6).to_a }
    def conversions(mdc6) = cached(:conversions, mdc6) { scoped(Master::DpcConversion).where(mdc6: mdc6).to_a }

    def procedures(mdc6, kind)
      cached(:procedures, [mdc6, kind]) { scoped(Master::DpcProcedure).where(mdc6: mdc6, kind: kind).to_a }
    end

    def points(dpc_codes)
      scoped(Master::DpcPoint).where(dpc_code: dpc_codes).index_by(&:dpc_code)
    end

    def ccpms(dpc_codes)
      scoped(Master::DpcCcpm).where(dpc_code: dpc_codes).to_h { |row| [row.dpc_code, row.ccpm_code] }
    end

    # 包括の対象外になる手術・検査のコード。
    def fee_for_service_codes
      cached(:fee_for_service, nil) do
        scoped(Master::DpcFeeForServiceCode).where(kind: %w[surgery test]).where.not(code: nil)
                                            .to_h { |row| [row.code, row.name] }
      end
    end

    def dummy_names
      cached(:dummies, nil) { Master::DpcDummyCode.where(edition: edition).to_h { |row| [row.code, row.name] } }
    end

    private

    def scoped(model)
      model.in_edition(edition, date)
    end

    def cached(kind, key)
      @cache.fetch([kind, key]) { @cache[[kind, key]] = yield }
    end
  end
end
