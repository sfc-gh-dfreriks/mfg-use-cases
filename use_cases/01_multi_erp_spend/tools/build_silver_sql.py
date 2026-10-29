"""Generate sql/02_silver_adapters.sql: one adapter view per (source system, slot, canonical object).

Canonical model (SILVER, all sources map into these columns):
  SUPPLIER        SOURCE_SLOT, SOURCE_SYSTEM, SUPPLIER_ID, SUPPLIER_NAME, COUNTRY, TAX_ID, DUNS, PAYMENT_TERMS
  PO_LINE         SOURCE_SLOT, SOURCE_SYSTEM, COMPANY_CODE, PLANT, PO_NUMBER, PO_ITEM, SUPPLIER_ID, MATERIAL, ITEM_TEXT,
                  MATERIAL_GROUP, QUANTITY, UOM, NET_PRICE, NET_VALUE, CURRENCY, PO_DATE, DELIVERY_DATE, CONTRACT_ID
  GOODS_RECEIPT   SOURCE_SLOT, SOURCE_SYSTEM, GR_DOC, PO_NUMBER, PO_ITEM, PLANT, SUPPLIER_ID, MATERIAL, GR_DATE, GR_QTY, GR_VALUE, CURRENCY
  INVOICE_LINE    SOURCE_SLOT, SOURCE_SYSTEM, COMPANY_CODE, INVOICE_ID, PO_NUMBER, PO_ITEM, SUPPLIER_ID, INVOICE_DATE, INV_QTY, INV_AMOUNT, CURRENCY
  PAYMENT         SOURCE_SLOT, SOURCE_SYSTEM, COMPANY_CODE, INVOICE_ID, SUPPLIER_ID, INVOICE_DATE, DUE_DATE, PAYMENT_DATE, AMOUNT,
                  DISCOUNT_TAKEN, CURRENCY, PAYMENT_TERMS
  CONTRACT_ITEM   SOURCE_SLOT, SOURCE_SYSTEM, CONTRACT_ID, SUPPLIER_ID, MATERIAL, VALID_FROM, VALID_TO, CONTRACT_PRICE_USD
  PRICE_CONDITION SOURCE_SLOT, SOURCE_SYSTEM, PO_NUMBER, PO_ITEM, CONDITION_TYPE, CONDITION_RATE, CONDITION_VALUE, CURRENCY

To add a customer's real system: point a new SRC_<SYSTEM> schema at the replicated tables
(Openflow, SLT, Fivetran, BDC share), add its adapter views here, and register them.
"""
import pathlib

DB = "MFG_SPEND_RISK"
OUT = pathlib.Path(__file__).parents[1] / "sql" / "02_silver_adapters.sql"
SLOTS_SAP = ["A", "B"]

def sap_ecc_s4(kind, inst):
    s = f"{DB}.SRC_{kind}_{inst}"
    slot, sysname = f"SAP_{inst}", {"ECC": "SAP ECC 6.0", "S4": "SAP S/4HANA"}[kind]
    hdr = f"'{slot}' AS SOURCE_SLOT, '{sysname}' AS SOURCE_SYSTEM"
    gr = (f"SELECT {hdr}, m.MBLNR AS GR_DOC, m.EBELN AS PO_NUMBER, m.EBELP::STRING AS PO_ITEM, m.WERKS AS PLANT, m.LIFNR AS SUPPLIER_ID,\n"
          f"  m.MATNR AS MATERIAL, {'k.BUDAT' if kind == 'ECC' else 'm.BUDAT'} AS GR_DATE, m.MENGE AS GR_QTY, m.DMBTR AS GR_VALUE, m.WAERS AS CURRENCY\n"
          + (f"FROM {s}.MSEG m JOIN {s}.MKPF k ON k.MBLNR = m.MBLNR AND k.MJAHR = m.MJAHR WHERE m.BWART = '101'"
             if kind == "ECC" else f"FROM {s}.MATDOC m WHERE m.BWART = '101'"))
    pay = (f"SELECT {hdr}, b.BUKRS AS COMPANY_CODE, b.BELNR AS INVOICE_ID, b.LIFNR AS SUPPLIER_ID, b.BLDAT AS INVOICE_DATE, b.NETDT AS DUE_DATE,\n"
           f"  b.AUGDT AS PAYMENT_DATE, b.WRBTR AS AMOUNT, b.WSKTO AS DISCOUNT_TAKEN, b.WAERS AS CURRENCY, b.ZTERM AS PAYMENT_TERMS FROM {s}.BSAK b"
           if kind == "ECC" else
           f"SELECT {hdr}, a.RBUKRS AS COMPANY_CODE, a.BELNR AS INVOICE_ID, a.LIFNR AS SUPPLIER_ID, a.BUDAT AS INVOICE_DATE, a.NETDT AS DUE_DATE,\n"
           f"  a.AUGDT AS PAYMENT_DATE, -a.WSL AS AMOUNT, a.SKNTO AS DISCOUNT_TAKEN, a.RWCUR AS CURRENCY, a.ZTERM AS PAYMENT_TERMS\n"
           f"FROM {s}.ACDOCA a WHERE a.BLART = 'RE' AND a.AUGDT IS NOT NULL")
    cond_t, ccy = ("KONV", "WAERS") if kind == "ECC" else ("PRCD_ELEMENTS", "WAERK")
    return {
        "SUPPLIER": (f"SELECT {hdr}, l.LIFNR AS SUPPLIER_ID, " + ("COALESCE(bp.NAME_ORG1, l.NAME1)" if kind == "S4" else "l.NAME1") +
                     " AS SUPPLIER_NAME, l.LAND1 AS COUNTRY, l.STCD1 AS TAX_ID, l.KRAUS AS DUNS, b.ZTERM AS PAYMENT_TERMS\n"
                     f"FROM {s}.LFA1 l " + (f"LEFT JOIN {s}.BUT000 bp ON bp.PARTNER = l.LIFNR " if kind == "S4" else "") +
                     f"LEFT JOIN (SELECT LIFNR, ANY_VALUE(ZTERM) ZTERM FROM {s}.LFB1 GROUP BY 1) b ON b.LIFNR = l.LIFNR"),
        "PO_LINE": (f"SELECT {hdr}, h.BUKRS AS COMPANY_CODE, p.WERKS AS PLANT, p.EBELN AS PO_NUMBER, p.EBELP::STRING AS PO_ITEM, h.LIFNR AS SUPPLIER_ID,\n"
                    f"  p.MATNR AS MATERIAL, p.TXZ01 AS ITEM_TEXT, p.MATKL AS MATERIAL_GROUP, p.MENGE AS QUANTITY, p.MEINS AS UOM,\n"
                    f"  p.NETPR / NULLIF(p.PEINH, 0) AS NET_PRICE, p.NETWR AS NET_VALUE, h.WAERS AS CURRENCY, h.BEDAT AS PO_DATE, e.EINDT AS DELIVERY_DATE,\n"
                    f"  p.KONNR AS CONTRACT_ID\n"
                    f"FROM {s}.EKPO p JOIN {s}.EKKO h ON h.EBELN = p.EBELN\n"
                    f"LEFT JOIN {s}.EKET e ON e.EBELN = p.EBELN AND e.EBELP = p.EBELP AND e.ETENR = 1\n"
                    f"WHERE COALESCE(p.LOEKZ, '') = '' AND h.BSTYP = 'F'"),
        "GOODS_RECEIPT": gr,
        "INVOICE_LINE": (f"SELECT {hdr}, k.BUKRS AS COMPANY_CODE, k.BELNR AS INVOICE_ID, r.EBELN AS PO_NUMBER, r.EBELP::STRING AS PO_ITEM, k.LIFNR AS SUPPLIER_ID,\n"
                         f"  k.BLDAT AS INVOICE_DATE, r.MENGE AS INV_QTY, r.WRBTR AS INV_AMOUNT, k.WAERS AS CURRENCY\n"
                         f"FROM {s}.RSEG r JOIN {s}.RBKP k ON k.BELNR = r.BELNR AND k.GJAHR = r.GJAHR"),
        "PAYMENT": pay,
        "CONTRACT_ITEM": (f"SELECT {hdr}, n.KONNR AS CONTRACT_ID, h.LIFNR AS SUPPLIER_ID, a.MATNR AS MATERIAL, h.KDATB AS VALID_FROM, h.KDATE AS VALID_TO,\n"
                          f"  n.NETPR AS CONTRACT_PRICE_USD\n"
                          f"FROM {s}.EINE n JOIN {s}.EINA a ON a.INFNR = n.INFNR JOIN {s}.EKKO_CONTRACT h ON h.EBELN = n.KONNR"),
        "PRICE_CONDITION": (f"SELECT {hdr}, h.EBELN AS PO_NUMBER, TRY_TO_NUMBER(c.KPOSN)::STRING AS PO_ITEM, c.KSCHL AS CONDITION_TYPE,\n"
                            f"  c.KBETR AS CONDITION_RATE, c.KWERT AS CONDITION_VALUE, c.{ccy} AS CURRENCY\n"
                            f"FROM {s}.{cond_t} c JOIN {s}.EKKO h ON h.KNUMV = c.KNUMV"),
    }

def sap_bw(inst):
    s = f"{DB}.SRC_BW_{inst}"
    hdr = f"'SAP_{inst}' AS SOURCE_SLOT, 'SAP BW/4HANA' AS SOURCE_SYSTEM"
    return {
        "SUPPLIER": f"SELECT {hdr}, VENDOR AS SUPPLIER_ID, TXTMD AS SUPPLIER_NAME, COUNTRY, TAX_NUMB AS TAX_ID, DBDUNS_NUM AS DUNS, PMNTTRMS AS PAYMENT_TERMS FROM {s}.BI0_PVENDOR",
        "PO_LINE": (f"SELECT {hdr}, COMP_CODE AS COMPANY_CODE, PLANT, DOC_NUM AS PO_NUMBER, DOC_ITEM::STRING AS PO_ITEM, VENDOR AS SUPPLIER_ID, MATERIAL,\n"
                    f"  NULL::STRING AS ITEM_TEXT, MATL_GROUP AS MATERIAL_GROUP, ORDER_QUAN AS QUANTITY, PO_UNIT AS UOM, NETPRICE AS NET_PRICE, ORDER_VAL AS NET_VALUE,\n"
                    f"  DOC_CURRCY AS CURRENCY, CALDAY AS PO_DATE, SCL_DELDAT AS DELIVERY_DATE, CONTRACT AS CONTRACT_ID FROM {s}.BIC_AZPUR_O01"),
        "GOODS_RECEIPT": (f"SELECT {hdr}, DOC_NUM || '-' || DOC_ITEM AS GR_DOC, DOC_NUM AS PO_NUMBER, DOC_ITEM::STRING AS PO_ITEM, PLANT, VENDOR AS SUPPLIER_ID,\n"
                          f"  MATERIAL, CALDAY AS GR_DATE, GR_QUAN AS GR_QTY, GR_VAL AS GR_VALUE, DOC_CURRCY AS CURRENCY FROM {s}.BIC_AZPUR_O03 WHERE MOVETYPE = '101'"),
        "INVOICE_LINE": (f"SELECT {hdr}, COMP_CODE AS COMPANY_CODE, INV_DOC_NO AS INVOICE_ID, DOC_NUM AS PO_NUMBER, DOC_ITEM::STRING AS PO_ITEM, VENDOR AS SUPPLIER_ID,\n"
                         f"  CALDAY AS INVOICE_DATE, INV_QTY, INV_VAL AS INV_AMOUNT, DOC_CURRCY AS CURRENCY FROM {s}.BIC_AZPUR_O02"),
        # 0FIAP_O03 carries no cash-discount amount and no payment terms: those stay NULL (coverage gap)
        "PAYMENT": (f"SELECT {hdr}, COMP_CODE AS COMPANY_CODE, AC_DOC_NO AS INVOICE_ID, VENDOR AS SUPPLIER_ID, DOC_DATE AS INVOICE_DATE, NETDUEDATE AS DUE_DATE,\n"
                    f"  CLEAR_DATE AS PAYMENT_DATE, DEB_CRE_DC AS AMOUNT, NULL::FLOAT AS DISCOUNT_TAKEN, DOC_CURRCY AS CURRENCY, NULL::STRING AS PAYMENT_TERMS\n"
                    f"FROM {s}.BI0_AFIAP_O0300 WHERE FI_DOCSTAT = 'C'"),
        "CONTRACT_ITEM": (f"SELECT {hdr}, CONTRACT AS CONTRACT_ID, VENDOR AS SUPPLIER_ID, MATERIAL, VALIDFROM AS VALID_FROM, VALIDTO AS VALID_TO,\n"
                          f"  NETPRICE_USD AS CONTRACT_PRICE_USD FROM {s}.BIC_AZPUR_O04"),
        # no PRICE_CONDITION: 0PUR does not model pricing conditions
    }

def sap_bdc(inst):
    s = f"{DB}.SRC_BDC_{inst}"
    hdr = f"'SAP_{inst}' AS SOURCE_SLOT, 'SAP BDC' AS SOURCE_SYSTEM"
    return {
        "SUPPLIER": f"SELECT {hdr}, Supplier AS SUPPLIER_ID, SupplierName AS SUPPLIER_NAME, Country AS COUNTRY, TaxNumber1 AS TAX_ID, NULL::STRING AS DUNS, PaymentTerms AS PAYMENT_TERMS FROM {s}.SUPPLIER",
        "PO_LINE": (f"SELECT {hdr}, CompanyCode AS COMPANY_CODE, Plant AS PLANT, PurchaseOrder AS PO_NUMBER, TRY_TO_NUMBER(PurchaseOrderItem)::STRING AS PO_ITEM,\n"
                    f"  Supplier AS SUPPLIER_ID, Material AS MATERIAL, PurchaseOrderItemText AS ITEM_TEXT, MaterialGroup AS MATERIAL_GROUP, OrderQuantity AS QUANTITY,\n"
                    f"  PurchaseOrderQuantityUnit AS UOM, NetPriceAmount AS NET_PRICE, NetAmount AS NET_VALUE, DocumentCurrency AS CURRENCY,\n"
                    f"  PurchaseOrderDate AS PO_DATE, ScheduleLineDeliveryDate AS DELIVERY_DATE, PurchaseContract AS CONTRACT_ID FROM {s}.PURCHASEORDERITEM"),
        # no GOODS_RECEIPT: material documents are not a BDC data product (playbook gap)
        "INVOICE_LINE": (f"SELECT {hdr}, CompanyCode AS COMPANY_CODE, SupplierInvoice AS INVOICE_ID, PurchaseOrder AS PO_NUMBER,\n"
                         f"  TRY_TO_NUMBER(PurchaseOrderItem)::STRING AS PO_ITEM, InvoicingParty AS SUPPLIER_ID, DocumentDate AS INVOICE_DATE,\n"
                         f"  QuantityInPurchaseOrderUnit AS INV_QTY, SupplierInvoiceItemAmount AS INV_AMOUNT, DocumentCurrency AS CURRENCY FROM {s}.SUPPLIERINVOICEITEM"),
        "PAYMENT": (f"SELECT {hdr}, CompanyCode AS COMPANY_CODE, AccountingDocument AS INVOICE_ID, Supplier AS SUPPLIER_ID, PostingDate AS INVOICE_DATE,\n"
                    f"  NetDueDate AS DUE_DATE, ClearingDate AS PAYMENT_DATE, -AmountInTransactionCurrency AS AMOUNT, CashDiscountAmount AS DISCOUNT_TAKEN,\n"
                    f"  TransactionCurrency AS CURRENCY, NULL::STRING AS PAYMENT_TERMS FROM {s}.ENTRYVIEWJOURNALENTRY WHERE ClearingDate IS NOT NULL"),
        "CONTRACT_ITEM": (f"SELECT {hdr}, PurchaseContract AS CONTRACT_ID, Supplier AS SUPPLIER_ID, Material AS MATERIAL, ValidityStartDate AS VALID_FROM,\n"
                          f"  ValidityEndDate AS VALID_TO, ContractNetPriceAmount AS CONTRACT_PRICE_USD FROM {s}.PURCHASECONTRACTITEM"),
        # no PRICE_CONDITION: PO pricing elements are not a BDC data product (playbook gap)
    }

def oracle():
    s, hdr = f"{DB}.SRC_ORACLE_EBS", "'ORACLE_EBS' AS SOURCE_SLOT, 'Oracle EBS R12' AS SOURCE_SYSTEM"
    return {
        "SUPPLIER": f"SELECT {hdr}, VENDOR_ID::STRING AS SUPPLIER_ID, VENDOR_NAME AS SUPPLIER_NAME, COUNTRY, NUM_1099 AS TAX_ID, ATTRIBUTE1_DUNS AS DUNS, 'NET 45' AS PAYMENT_TERMS FROM {s}.AP_SUPPLIERS WHERE ENABLED_FLAG = 'Y'",
        "PO_LINE": (f"SELECT {hdr}, 'ORACLE_EBS' AS COMPANY_CODE, 'ORACLE_EBS' AS PLANT, h.SEGMENT1 AS PO_NUMBER, l.LINE_NUM::STRING AS PO_ITEM, h.VENDOR_ID::STRING AS SUPPLIER_ID,\n"
                    f"  l.ITEM_NUMBER AS MATERIAL, l.ITEM_DESCRIPTION AS ITEM_TEXT, l.CATEGORY_CODE AS MATERIAL_GROUP, l.QUANTITY, l.UNIT_MEAS_LOOKUP_CODE AS UOM,\n"
                    f"  l.UNIT_PRICE AS NET_PRICE, l.QUANTITY * l.UNIT_PRICE AS NET_VALUE, h.CURRENCY_CODE AS CURRENCY, h.CREATION_DATE AS PO_DATE,\n"
                    f"  ll.NEED_BY_DATE AS DELIVERY_DATE, NULL::STRING AS CONTRACT_ID\n"
                    f"FROM {s}.PO_LINES_ALL l JOIN {s}.PO_HEADERS_ALL h ON h.PO_HEADER_ID = l.PO_HEADER_ID\n"
                    f"LEFT JOIN {s}.PO_LINE_LOCATIONS_ALL ll ON ll.PO_LINE_ID = l.PO_LINE_ID WHERE h.TYPE_LOOKUP_CODE = 'STANDARD'"),
        "GOODS_RECEIPT": (f"SELECT {hdr}, r.TRANSACTION_ID::STRING AS GR_DOC, h.SEGMENT1 AS PO_NUMBER, l.LINE_NUM::STRING AS PO_ITEM, 'ORACLE_EBS' AS PLANT,\n"
                          f"  r.VENDOR_ID::STRING AS SUPPLIER_ID, l.ITEM_NUMBER AS MATERIAL, r.TRANSACTION_DATE AS GR_DATE, r.QUANTITY AS GR_QTY,\n"
                          f"  r.QUANTITY * l.UNIT_PRICE AS GR_VALUE, h.CURRENCY_CODE AS CURRENCY\n"
                          f"FROM {s}.RCV_TRANSACTIONS r JOIN {s}.PO_LINES_ALL l ON l.PO_LINE_ID = r.PO_LINE_ID\n"
                          f"JOIN {s}.PO_HEADERS_ALL h ON h.PO_HEADER_ID = l.PO_HEADER_ID WHERE r.TRANSACTION_TYPE = 'RECEIVE'"),
        "INVOICE_LINE": (f"SELECT {hdr}, 'ORACLE_EBS' AS COMPANY_CODE, i.INVOICE_NUM AS INVOICE_ID, h.SEGMENT1 AS PO_NUMBER, pl.LINE_NUM::STRING AS PO_ITEM,\n"
                         f"  i.VENDOR_ID::STRING AS SUPPLIER_ID, i.INVOICE_DATE, il.QUANTITY_INVOICED AS INV_QTY, il.AMOUNT AS INV_AMOUNT, i.INVOICE_CURRENCY_CODE AS CURRENCY\n"
                         f"FROM {s}.AP_INVOICE_LINES_ALL il JOIN {s}.AP_INVOICES_ALL i ON i.INVOICE_ID = il.INVOICE_ID\n"
                         f"LEFT JOIN {s}.PO_LINES_ALL pl ON pl.PO_LINE_ID = il.PO_LINE_ID LEFT JOIN {s}.PO_HEADERS_ALL h ON h.PO_HEADER_ID = il.PO_HEADER_ID"),
        "PAYMENT": (f"SELECT {hdr}, 'ORACLE_EBS' AS COMPANY_CODE, i.INVOICE_NUM AS INVOICE_ID, i.VENDOR_ID::STRING AS SUPPLIER_ID, i.INVOICE_DATE,\n"
                    f"  DATEADD(day, 45, i.INVOICE_DATE) AS DUE_DATE, c.CHECK_DATE AS PAYMENT_DATE, p.AMOUNT, 0::FLOAT AS DISCOUNT_TAKEN, c.CURRENCY_CODE AS CURRENCY,\n"
                    f"  i.TERMS_NAME AS PAYMENT_TERMS\n"
                    f"FROM {s}.AP_INVOICE_PAYMENTS_ALL p JOIN {s}.AP_INVOICES_ALL i ON i.INVOICE_ID = p.INVOICE_ID JOIN {s}.AP_CHECKS_ALL c ON c.CHECK_ID = p.CHECK_ID"),
    }

def d365():
    s, hdr = f"{DB}.SRC_D365", "'D365' AS SOURCE_SLOT, 'Microsoft Dynamics 365 F&O' AS SOURCE_SYSTEM"
    return {
        "SUPPLIER": (f"SELECT {hdr}, v.ACCOUNTNUM AS SUPPLIER_ID, p.NAME AS SUPPLIER_NAME, v.COUNTRYREGIONID AS COUNTRY, v.VATNUM AS TAX_ID, v.DUNSNUMBER AS DUNS,\n"
                     f"  v.PAYMTERMID AS PAYMENT_TERMS FROM {s}.VENDTABLE v JOIN {s}.DIRPARTYTABLE p ON p.RECID = v.PARTY"),
        "PO_LINE": (f"SELECT {hdr}, 'D365' AS COMPANY_CODE, 'D365' AS PLANT, h.PURCHID AS PO_NUMBER, l.LINENUMBER::STRING AS PO_ITEM, h.ORDERACCOUNT AS SUPPLIER_ID,\n"
                    f"  l.ITEMID AS MATERIAL, l.NAME AS ITEM_TEXT, l.PROCUREMENTCATEGORY AS MATERIAL_GROUP, l.PURCHQTY AS QUANTITY, l.PURCHUNIT AS UOM,\n"
                    f"  l.PURCHPRICE AS NET_PRICE, l.LINEAMOUNT AS NET_VALUE, l.CURRENCYCODE AS CURRENCY, h.CREATEDDATETIME::DATE AS PO_DATE,\n"
                    f"  h.DELIVERYDATE AS DELIVERY_DATE, NULL::STRING AS CONTRACT_ID FROM {s}.PURCHLINE l JOIN {s}.PURCHTABLE h ON h.PURCHID = l.PURCHID"),
        "GOODS_RECEIPT": (f"SELECT {hdr}, g.ORIGPURCHID || '-' || g.PURCHLINELINENUMBER AS GR_DOC, g.ORIGPURCHID AS PO_NUMBER, g.PURCHLINELINENUMBER::STRING AS PO_ITEM,\n"
                          f"  'D365' AS PLANT, h.ORDERACCOUNT AS SUPPLIER_ID, g.ITEMID AS MATERIAL, g.DELIVERYDATE AS GR_DATE, g.QTY AS GR_QTY,\n"
                          f"  g.QTY * l.PURCHPRICE AS GR_VALUE, l.CURRENCYCODE AS CURRENCY\n"
                          f"FROM {s}.VENDPACKINGSLIPTRANS g JOIN {s}.PURCHLINE l ON l.PURCHID = g.ORIGPURCHID AND l.LINENUMBER = g.PURCHLINELINENUMBER\n"
                          f"JOIN {s}.PURCHTABLE h ON h.PURCHID = g.ORIGPURCHID"),
        "INVOICE_LINE": (f"SELECT {hdr}, 'D365' AS COMPANY_CODE, t.INVOICEID AS INVOICE_ID, t.PURCHID AS PO_NUMBER, t.LINENUM::STRING AS PO_ITEM, j.INVOICEACCOUNT AS SUPPLIER_ID,\n"
                         f"  j.INVOICEDATE AS INVOICE_DATE, t.QTY AS INV_QTY, t.LINEAMOUNT AS INV_AMOUNT, j.CURRENCYCODE AS CURRENCY\n"
                         f"FROM {s}.VENDINVOICETRANS t JOIN {s}.VENDINVOICEJOUR j ON j.INVOICEID = t.INVOICEID"),
        "PAYMENT": (f"SELECT {hdr}, 'D365' AS COMPANY_CODE, v.INVOICE AS INVOICE_ID, v.ACCOUNTNUM AS SUPPLIER_ID, j.INVOICEDATE AS INVOICE_DATE,\n"
                    f"  DATEADD(day, 30, j.INVOICEDATE) AS DUE_DATE, v.CLOSED AS PAYMENT_DATE, v.AMOUNTCUR AS AMOUNT, 0::FLOAT AS DISCOUNT_TAKEN,\n"
                    f"  v.CURRENCYCODE AS CURRENCY, 'Net30' AS PAYMENT_TERMS FROM {s}.VENDTRANS v JOIN {s}.VENDINVOICEJOUR j ON j.INVOICEID = v.INVOICE"),
    }

def netsuite():
    s, hdr = f"{DB}.SRC_NETSUITE", "'NETSUITE' AS SOURCE_SLOT, 'Oracle NetSuite' AS SOURCE_SYSTEM"
    return {
        "SUPPLIER": f"SELECT {hdr}, ID::STRING AS SUPPLIER_ID, COMPANYNAME AS SUPPLIER_NAME, COUNTRY, TAXIDNUM AS TAX_ID, CUSTENTITY_DUNS AS DUNS, TERMS AS PAYMENT_TERMS FROM {s}.VENDOR WHERE ISINACTIVE = 'F'",
        "PO_LINE": (f"SELECT {hdr}, 'NETSUITE' AS COMPANY_CODE, 'NETSUITE' AS PLANT, t.TRANID AS PO_NUMBER, l.ID::STRING AS PO_ITEM, t.ENTITY::STRING AS SUPPLIER_ID,\n"
                    f"  i.ITEMID AS MATERIAL, l.MEMO AS ITEM_TEXT, l.CLASS AS MATERIAL_GROUP, l.QUANTITY, NULL::STRING AS UOM, l.RATE AS NET_PRICE,\n"
                    f"  l.FOREIGNAMOUNT AS NET_VALUE, t.CURRENCY, t.TRANDATE AS PO_DATE, NULL::DATE AS DELIVERY_DATE, NULL::STRING AS CONTRACT_ID\n"
                    f"FROM {s}.TRANSACTIONLINE l JOIN {s}.TRANSACTION t ON t.ID = l.TRANSACTION LEFT JOIN {s}.ITEM i ON i.ID = l.ITEM WHERE t.TYPE = 'PurchOrd'"),
        "GOODS_RECEIPT": (f"SELECT {hdr}, r.TRANID || '-' || l.ID AS GR_DOC, po.TRANID AS PO_NUMBER, l.ID::STRING AS PO_ITEM, 'NETSUITE' AS PLANT, r.ENTITY::STRING AS SUPPLIER_ID,\n"
                          f"  i.ITEMID AS MATERIAL, r.TRANDATE AS GR_DATE, l.QUANTITY AS GR_QTY, l.QUANTITY * l.RATE AS GR_VALUE, r.CURRENCY\n"
                          f"FROM {s}.TRANSACTIONLINE l JOIN {s}.TRANSACTION r ON r.ID = l.TRANSACTION JOIN {s}.TRANSACTION po ON po.ID = r.CREATEDFROM\n"
                          f"LEFT JOIN {s}.ITEM i ON i.ID = l.ITEM WHERE r.TYPE = 'ItemRcpt'"),
        "INVOICE_LINE": (f"SELECT {hdr}, 'NETSUITE' AS COMPANY_CODE, b.TRANID AS INVOICE_ID, po.TRANID AS PO_NUMBER, l.ID::STRING AS PO_ITEM, b.ENTITY::STRING AS SUPPLIER_ID,\n"
                         f"  b.TRANDATE AS INVOICE_DATE, l.QUANTITY AS INV_QTY, l.FOREIGNAMOUNT AS INV_AMOUNT, b.CURRENCY\n"
                         f"FROM {s}.TRANSACTIONLINE l JOIN {s}.TRANSACTION b ON b.ID = l.TRANSACTION LEFT JOIN {s}.TRANSACTION po ON po.ID = b.CREATEDFROM WHERE b.TYPE = 'VendBill'"),
        "PAYMENT": (f"SELECT {hdr}, 'NETSUITE' AS COMPANY_CODE, b.TRANID AS INVOICE_ID, p.ENTITY::STRING AS SUPPLIER_ID, b.TRANDATE AS INVOICE_DATE,\n"
                    f"  DATEADD(day, 30, b.TRANDATE) AS DUE_DATE, p.TRANDATE AS PAYMENT_DATE, p.FOREIGNTOTAL AS AMOUNT, 0::FLOAT AS DISCOUNT_TAKEN, p.CURRENCY,\n"
                    f"  'Net 30' AS PAYMENT_TERMS FROM {s}.TRANSACTION p JOIN {s}.TRANSACTION b ON b.ID = p.CREATEDFROM WHERE p.TYPE = 'VendPymt'"),
    }

def coupa():
    s, hdr = f"{DB}.SRC_COUPA", "'COUPA' AS SOURCE_SLOT, 'Coupa' AS SOURCE_SYSTEM"
    rmg = f"{DB}.SRC_THIRD_PARTY.REF_MATERIAL_GROUP"
    org = f"(SELECT COMPANY_CODE, MIN(PLANT) AS PLANT FROM {DB}.SRC_THIRD_PARTY.REF_ORG GROUP BY 1)"
    return {
        "SUPPLIER": (f"SELECT {hdr}, RAW:id::STRING AS SUPPLIER_ID, RAW:name::STRING AS SUPPLIER_NAME, RAW:country::STRING AS COUNTRY,\n"
                     f"  RAW:\"tax-id\"::STRING AS TAX_ID, RAW:duns::STRING AS DUNS, 'Net 45' AS PAYMENT_TERMS FROM {s}.COUPA_SUPPLIERS"),
        "PO_LINE": (f"WITH l AS (SELECT p.RAW AS P, f.value AS L FROM {s}.COUPA_PURCHASE_ORDERS p, LATERAL FLATTEN(p.RAW:\"order-lines\") f)\n"
                    f"SELECT {hdr}, SPLIT_PART(l.P:account.code::STRING, '-', 1) AS COMPANY_CODE, o.PLANT, l.P:\"po-number\"::STRING AS PO_NUMBER,\n"
                    f"  l.L:\"line-num\"::STRING AS PO_ITEM, l.P:supplier.id::STRING AS SUPPLIER_ID, NULL::STRING AS MATERIAL,\n"
                    f"  l.L:description::STRING AS ITEM_TEXT, g.MATERIAL_GROUP, l.L:quantity::FLOAT AS QUANTITY, l.L:uom.code::STRING AS UOM,\n"
                    f"  l.L:price::FLOAT AS NET_PRICE, l.L:total::FLOAT AS NET_VALUE, l.P:currency.code::STRING AS CURRENCY,\n"
                    f"  l.P:\"created-at\"::TIMESTAMP::DATE AS PO_DATE, NULL::DATE AS DELIVERY_DATE, NULL::STRING AS CONTRACT_ID\n"
                    f"FROM l LEFT JOIN {rmg} g ON g.MATERIAL_GROUP_TEXT = l.L:commodity.name::STRING\n"
                    f"LEFT JOIN {org} o ON o.COMPANY_CODE = SPLIT_PART(l.P:account.code::STRING, '-', 1)"),
        # no GOODS_RECEIPT: indirect services are receipted in Coupa only as approvals
        "INVOICE_LINE": (f"SELECT {hdr}, SPLIT_PART(po.RAW:account.code::STRING, '-', 1) AS COMPANY_CODE, i.RAW:\"invoice-number\"::STRING AS INVOICE_ID,\n"
                         f"  i.RAW:\"order-header-num\"::STRING AS PO_NUMBER, NULL::STRING AS PO_ITEM, i.RAW:supplier.id::STRING AS SUPPLIER_ID,\n"
                         f"  i.RAW:\"invoice-date\"::DATE AS INVOICE_DATE, NULL::FLOAT AS INV_QTY, i.RAW:total::FLOAT AS INV_AMOUNT, i.RAW:currency.code::STRING AS CURRENCY\n"
                         f"FROM {s}.COUPA_INVOICES i LEFT JOIN {s}.COUPA_PURCHASE_ORDERS po ON po.RAW:\"po-number\"::STRING = i.RAW:\"order-header-num\"::STRING"),
        "PAYMENT": (f"SELECT {hdr}, SPLIT_PART(po.RAW:account.code::STRING, '-', 1) AS COMPANY_CODE, i.RAW:\"invoice-number\"::STRING AS INVOICE_ID,\n"
                    f"  i.RAW:supplier.id::STRING AS SUPPLIER_ID, i.RAW:\"invoice-date\"::DATE AS INVOICE_DATE, DATEADD(day, 45, i.RAW:\"invoice-date\"::DATE) AS DUE_DATE,\n"
                    f"  i.RAW:\"payment-date\"::DATE AS PAYMENT_DATE, i.RAW:total::FLOAT AS AMOUNT, 0::FLOAT AS DISCOUNT_TAKEN, i.RAW:currency.code::STRING AS CURRENCY,\n"
                    f"  'Net 45' AS PAYMENT_TERMS\n"
                    f"FROM {s}.COUPA_INVOICES i LEFT JOIN {s}.COUPA_PURCHASE_ORDERS po ON po.RAW:\"po-number\"::STRING = i.RAW:\"order-header-num\"::STRING\n"
                    f"WHERE i.RAW:\"payment-date\"::DATE <= '2026-09-30'"),
    }

SYSTEM_CODES = {"ECC": "SAP ECC 6.0", "S4": "SAP S/4HANA", "BW": "SAP BW/4HANA", "BDC": "SAP BDC",
                "ORACLE_EBS": "Oracle EBS R12", "D365": "Microsoft Dynamics 365 F&O", "NETSUITE": "Oracle NetSuite", "COUPA": "Coupa"}

def main():
    adapters = []  # (slot, system_code, object, sql)
    for inst in SLOTS_SAP:
        for kind in ["ECC", "S4"]:
            adapters += [(f"SAP_{inst}", kind, o, q) for o, q in sap_ecc_s4(kind, inst).items()]
        adapters += [(f"SAP_{inst}", "BW", o, q) for o, q in sap_bw(inst).items()]
        adapters += [(f"SAP_{inst}", "BDC", o, q) for o, q in sap_bdc(inst).items()]
    for code, fn in [("ORACLE_EBS", oracle), ("D365", d365), ("NETSUITE", netsuite), ("COUPA", coupa)]:
        adapters += [(code, code, o, q) for o, q in fn().items()]
    out = ["-- GENERATED by tools/build_silver_sql.py. Do not edit by hand.",
           "-- One adapter view per (slot, source system, canonical object), registered in CONFIG.ADAPTER_REGISTRY.",
           f"USE DATABASE {DB};", "CREATE SCHEMA IF NOT EXISTS ADAPTERS;", "CREATE SCHEMA IF NOT EXISTS CONFIG;",
           "CREATE OR REPLACE TABLE CONFIG.ADAPTER_REGISTRY (SOURCE_SLOT STRING, SYSTEM_CODE STRING, SYSTEM_NAME STRING, OBJECT_NAME STRING, VIEW_NAME STRING);"]
    reg = []
    for slot, code, obj, sql in adapters:
        view = f"ADAPTERS.{slot}_{code}_{obj}" if slot.startswith("SAP_") else f"ADAPTERS.{slot}_{obj}"
        out.append(f"\nCREATE OR REPLACE VIEW {view} AS\n{sql};")
        reg.append(f"('{slot}', '{code}', '{SYSTEM_CODES[code]}', '{obj}', '{view}')")
    out.append("\nINSERT INTO CONFIG.ADAPTER_REGISTRY VALUES\n  " + ",\n  ".join(reg) + ";")
    OUT.write_text("\n".join(out) + "\n")
    print(f"wrote {OUT} ({len(adapters)} adapters)")

# --------------------------------------------------------------------------- dbt output
import re
import yaml

DBT = pathlib.Path(__file__).parents[1] / "dbt"
SRC_RE = re.compile(rf"{DB}\.(SRC_\w+)\.(\w+)")

def to_dbt(sql: str) -> str:
    return SRC_RE.sub(lambda m: "{{ source('%s', '%s') }}" % (m.group(1).lower(), m.group(2).lower()), sql)

def build_dbt():
    adapters = []
    for inst in SLOTS_SAP:
        for kind in ["ECC", "S4"]:
            adapters += [(f"SAP_{inst}", kind, o, q) for o, q in sap_ecc_s4(kind, inst).items()]
        adapters += [(f"SAP_{inst}", "BW", o, q) for o, q in sap_bw(inst).items()]
        adapters += [(f"SAP_{inst}", "BDC", o, q) for o, q in sap_bdc(inst).items()]
    for code, fn in [("ORACLE_EBS", oracle), ("D365", d365), ("NETSUITE", netsuite), ("COUPA", coupa)]:
        adapters += [(code, code, o, q) for o, q in fn().items()]
    stg = DBT / "models" / "staging"
    for old in stg.rglob("stg_*.sql"):
        old.unlink()
    registry, used = {}, {}
    for slot, code, obj, sql in adapters:
        name = f"stg_{slot.lower()}__{code.lower()}__{obj.lower()}"
        folder = stg / slot.lower()
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{name}.sql").write_text(f"-- {SYSTEM_CODES[code]} -> canonical {obj} ({slot}). Generated by tools/build_silver_sql.py.\n"
                                            + to_dbt(sql) + "\n")
        registry.setdefault(obj, {}).setdefault(slot, {})[code] = name
        for s, t in SRC_RE.findall(sql):
            used.setdefault(s.lower(), set()).add(t.lower())
    # sources.yml, from the tables the adapters actually read
    out_dir = pathlib.Path(__file__).parents[1] / "data_gen" / "out"
    # third-party and reference tables are read by the gold layer, not the adapters
    used.setdefault("src_third_party", set()).update(f.stem.lower() for f in (out_dir / "SRC_THIRD_PARTY").glob("*.parquet"))
    srcs = []
    for s in sorted(used):
        desc = {"src_third_party": "Third-party risk, ESG, PPI and reference data"}.get(s, f"Native {s[4:].upper()} tables, landed unchanged")
        srcs.append({"name": s, "database": DB, "schema": s.upper(), "description": desc,
                     "tables": [{"name": t} for t in sorted(used[s])]})
    (DBT / "models" / "staging" / "_sources.yml").write_text(yaml.safe_dump({"version": 2, "sources": srcs}, sort_keys=False))
    # adapter registry as a macro, so intermediate models can union the selected adapters
    reg = "{% macro adapter_registry() %}\n  {{ return(" + json_like(registry) + ") }}\n{% endmacro %}\n"
    (DBT / "macros" / "adapter_registry.sql").write_text("-- Generated by tools/build_silver_sql.py: object -> slot -> system -> staging model\n" + reg)
    print(f"dbt: {len(adapters)} staging models, {sum(len(v) for v in used.values())} source tables")
    write_mapping_doc(adapters)

OBJECTS = ["SUPPLIER", "PO_LINE", "GOODS_RECEIPT", "INVOICE_LINE", "PAYMENT", "CONTRACT_ITEM", "PRICE_CONDITION"]

def write_mapping_doc(adapters):
    """docs/source_mapping.md: which native tables feed each canonical object, per source system (slot A shown for SAP)."""
    seen = {}
    for slot, code, obj, sql in adapters:
        if slot == "SAP_B":
            continue
        tables = sorted({t for _, t in SRC_RE.findall(sql)} - {"REF_MATERIAL_GROUP", "REF_ORG"})
        seen[(code, obj)] = ", ".join(f"`{t}`" for t in tables)
    lines = ["# Source-to-canonical mapping", "",
             "Generated by `tools/build_silver_sql.py` from the dbt staging adapters. Each cell lists the native tables the adapter reads;",
             "`not available` means that source system cannot supply the canonical object (a real coverage gap, shown in the app).", "",
             "| Canonical object | " + " | ".join(SYSTEM_CODES[c] for c in SYSTEM_CODES) + " |",
             "|---|" + "---|" * len(SYSTEM_CODES)]
    for obj in OBJECTS:
        lines.append(f"| {obj} | " + " | ".join(seen.get((c, obj), "not available") for c in SYSTEM_CODES) + " |")
    lines += ["", "## Canonical columns", "", "See `dbt/macros/canonical_columns.sql`; every adapter selects exactly these columns, cast to these types.", ""]
    out = pathlib.Path(__file__).parents[1] / "docs" / "source_mapping.md"
    out.write_text("\n".join(lines) + "\n")
    print(f"wrote {out}")

def json_like(d):
    import json
    return json.dumps(d, sort_keys=True)

if __name__ == "__main__":
    build_dbt()
